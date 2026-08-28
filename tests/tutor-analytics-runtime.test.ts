import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import {
  createLearnerTutorTurnAcceptanceRequest,
  createLearnerReplyStreamRequest,
  getLearnerAgentForUser,
  learnerAgentObjectName,
  TUTOR_ABANDONMENT_IDLE_MS,
  TUTOR_ABANDONMENT_IN_FLIGHT_RETRY_MS,
} from '../src/lib/runtime/learnerAgent';

const db = getDb(env.DB);

afterEach(async () => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

async function fixture(settings: Record<string, unknown> = {}) {
  const userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@tutor-analytics.test`, passwordHash: 'x', settings });
  const raw = env.LEARNER_AGENT.getByName(learnerAgentObjectName(userId));
  const learner = await getLearnerAgentForUser(env, userId);
  const conversation = await learner.createConversation({ kcId: 'kc-1', mode: 'recall' });
  return { userId, raw, learner, conversation };
}

async function enableAnalytics(raw: DurableObjectStub) {
  await runInDurableObject(raw, (instance) => {
    Object.assign((instance as unknown as { env: Record<string, unknown> }).env, {
      ANALYTICS_ENABLED: 'true',
      POSTHOG_HOST: 'https://us.i.posthog.com',
      POSTHOG_PROJECT_TOKEN: 'phc_test',
      ANALYTICS_EXCLUDED_USER_IDS: '',
    });
  });
}

async function accept(raw: DurableObjectStub, conversationId: string, content: string) {
  const response = await raw.fetch(createLearnerTutorTurnAcceptanceRequest({
    conversationId,
    content,
    analytics: { sessionId: 'session-1', surface: '/tutor/[kcId]' },
  }));
  expect(response.ok).toBe(true);
  return response.json<{ turnId: string }>();
}

async function makeDue(raw: DurableObjectStub) {
  await runInDurableObject(raw, async (_instance, state) => {
    const due = Date.now() - 1;
    state.storage.sql.exec('UPDATE tutor_abandonment_alarms SET last_user_turn_at = ?, scheduled_at = ?', due - TUTOR_ABANDONMENT_IDLE_MS, due);
    await state.storage.setAlarm(Date.now() + 60_000);
  });
}

describe('tutor inactivity alarms', () => {
  it('reschedules from the latest accepted learner turn and emits bounded metadata without text', async () => {
    const { raw, learner, conversation } = await fixture();
    await enableAnalytics(raw);
    await accept(raw, conversation.id, 'private first answer');
    const firstAlarm = await runInDurableObject(raw, (_instance, state) => state.storage.getAlarm());
    await learner.cancelStreamingReply(conversation.id);
    await accept(raw, conversation.id, 'private second answer');
    const secondAlarm = await runInDurableObject(raw, (_instance, state) => state.storage.getAlarm());
    expect(secondAlarm).toBeGreaterThanOrEqual(firstAlarm!);
    await learner.cancelStreamingReply(conversation.id);

    await makeDue(raw);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    }));
    await expect(runDurableObjectAlarm(raw)).resolves.toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      event: 'tutor_abandoned',
      properties: {
        conversation_id: conversation.id,
        session_id: 'session-1',
        turn_count: 2,
        $insert_id: expect.stringContaining(`tutor-abandoned:${conversation.id}:`),
      },
    });
    expect(JSON.stringify(bodies)).not.toContain('private first answer');
    expect(JSON.stringify(bodies)).not.toContain('private second answer');

    // Inactivity is an observation, not a terminal. A resumed conversation
    // can arm and emit again from a later learner turn with a fresh identity.
    await accept(raw, conversation.id, 'private resumed answer');
    await learner.cancelStreamingReply(conversation.id);
    await makeDue(raw);
    await expect(runDurableObjectAlarm(raw)).resolves.toBe(true);
    expect(bodies).toHaveLength(2);
    const insertIds = bodies.map((body) => (body.properties as Record<string, unknown>).$insert_id);
    expect(new Set(insertIds).size).toBe(2);
    expect(JSON.stringify(bodies)).not.toContain('private resumed answer');
  });

  it('keeps a completed turn armed and defers an in-flight turn without export', async () => {
    const { raw, learner, conversation } = await fixture();
    await enableAnalytics(raw);
    const accepted = await accept(raw, conversation.id, 'private completed answer');
    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Safe reply.' } }] })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }), { status: 200 })));
    const reply = await raw.fetch(createLearnerReplyStreamRequest({
      conversationId: conversation.id,
      turnId: accepted.turnId,
      systemPrompt: 'A trusted system prompt long enough for validation.',
      messageCap: 30,
    }));
    await reply.text();
    const armedAfterReply = await runInDurableObject(raw, (_instance, state) =>
      state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM tutor_abandonment_alarms WHERE conversation_id = ?', conversation.id).one().count,
    );
    expect(armedAfterReply).toBe(1);

    await learner.cancelStreamingReply(conversation.id);
    await accept(raw, conversation.id, 'private in-flight answer');
    await makeDue(raw);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(await runDurableObjectAlarm(raw)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    const deferred = await runInDurableObject(raw, (_instance, state) =>
      state.storage.sql.exec<{ scheduled_at: number }>('SELECT scheduled_at FROM tutor_abandonment_alarms WHERE conversation_id = ?', conversation.id).one().scheduled_at,
    );
    expect(deferred).toBeGreaterThanOrEqual(Date.now() + TUTOR_ABANDONMENT_IN_FLIGHT_RETRY_MS - 1_000);

    await learner.cancelStreamingReply(conversation.id);
    const stillArmed = await runInDurableObject(raw, (_instance, state) =>
      state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM tutor_abandonment_alarms WHERE conversation_id = ?', conversation.id).one().count,
    );
    expect(stillArmed).toBe(1);
  });

  it('suppresses ended conversations and re-checks account opt-out at fire', async () => {
    const ended = await fixture();
    await enableAnalytics(ended.raw);
    await accept(ended.raw, ended.conversation.id, 'never export me');
    await ended.learner.cancelStreamingReply(ended.conversation.id);
    await ended.learner.endConversation(ended.conversation.id);
    expect(await runDurableObjectAlarm(ended.raw)).toBe(false);

    const optedOut = await fixture({ analytics_opt_out: false });
    await enableAnalytics(optedOut.raw);
    await accept(optedOut.raw, optedOut.conversation.id, 'also private');
    await db.update(users).set({ settings: { analytics_opt_out: true } }).where(eq(users.id, optedOut.userId));
    await makeDue(optedOut.raw);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(await runDurableObjectAlarm(optedOut.raw)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retains a failed delivery for alarm retry with the same insert id', async () => {
    const { raw, learner, conversation } = await fixture();
    await enableAnalytics(raw);
    await accept(raw, conversation.id, 'retry-safe private turn');
    await learner.cancelStreamingReply(conversation.id);
    await makeDue(raw);
    const insertIds: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      insertIds.push(body.properties.$insert_id);
      return new Response(null, { status: insertIds.length === 1 ? 503 : 200 });
    }));

    await expect(runDurableObjectAlarm(raw)).rejects.toThrow('PostHog ingestion returned 503');
    await runInDurableObject(raw, async (_instance, state) => state.storage.setAlarm(Date.now() + 60_000));
    await expect(runDurableObjectAlarm(raw)).resolves.toBe(true);
    expect(insertIds).toHaveLength(2);
    expect(new Set(insertIds).size).toBe(1);
  });
});
