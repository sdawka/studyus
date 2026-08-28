import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, events, kcs, users } from '../src/db/schema';
import { getLearnerAgentForUser } from '../src/lib/runtime/learnerAgent';
import {
  createRuntimeConversation,
  endRuntimeConversation,
  getRuntimeConversation,
  streamRuntimeTutorReply,
} from '../src/lib/runtime/tutorRuntime';
import { ConversationCapReachedError, MAX_MESSAGES_PER_CONVERSATION, MAX_MESSAGES_PER_CONVERSATION_ABSORB } from '../src/lib/services/tutor/conversations';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let kcId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  kcId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'test' });
  await db.insert(courses).values({ id: courseId, userId, code: 'CAP 101', slug: `cap-${courseId}`, title: 'Cap test', overview: null });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Core' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Cap KC', kcType: 'fact' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function upstreamReply(text = 'A concise tutor reply.') {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function mockReply(text?: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(upstreamReply(text), { status: 200 })));
}

async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return new TextDecoder().decode(concat(chunks));
    if (value) chunks.push(value);
  }
}

function concat(chunks: Uint8Array[]) {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function fillConversation(conversationId: string, count: number) {
  const agent = await getLearnerAgentForUser(env, userId);
  for (let index = 0; index < count; index++) {
    await agent.appendMessage({ conversationId, content: `existing message ${index}` });
  }
  return agent;
}

async function tutorSessionEvents() {
  const rows = await db.select().from(events).where(eq(events.userId, userId));
  return rows.filter((event) => event.type === 'tutor_session');
}

describe('runtime tutor cap finalization', () => {
  it('queues content-free message analytics only after the learner turn is durable', async () => {
    const conversation = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'recall' });
    const pending: Promise<unknown>[] = [];
    const analyticsBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      if (String(input).includes('posthog.com')) {
        analyticsBodies.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 200 });
      }
      return new Response(upstreamReply(), { status: 200 });
    }));
    const analyticsEnv = Object.assign(Object.create(env), {
      ANALYTICS_ENABLED: 'true',
      POSTHOG_HOST: 'https://us.i.posthog.com',
      POSTHOG_PROJECT_TOKEN: 'phc_test',
      ANALYTICS_EXCLUDED_USER_IDS: '',
    }) as Cloudflare.Env;

    const stream = await streamRuntimeTutorReply(db, analyticsEnv, userId, conversation.id, 'my private explanation', {
      request: new Request('https://studyus.app/api/v1/tutor/conversations/id/messages', {
        headers: { cookie: 'studyus_session_id=session-message' },
      }),
      execution: { waitUntil: (promise) => pending.push(promise) },
      analyticsOptOut: false,
      surface: '/tutor/[kcId]',
    });
    const durable = await (await getLearnerAgentForUser(env, userId)).getConversation(conversation.id);
    expect(durable.messages[0]).toMatchObject({ role: 'user', content: 'my private explanation' });
    await drain(stream);
    await Promise.all(pending);

    expect(analyticsBodies).toHaveLength(1);
    expect(analyticsBodies[0]).toMatchObject({
      event: 'tutor_message_sent',
      properties: {
        conversation_id: conversation.id,
        session_id: 'session-message',
        surface: '/tutor/[kcId]',
        turn_index: 1,
      },
    });
    expect(JSON.stringify(analyticsBodies)).not.toContain('my private explanation');
  });

  it('accepts the durable tutor turn but schedules no analytics under request DNT', async () => {
    const conversation = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'recall' });
    mockReply();
    const waitUntil = vi.fn();
    const analyticsEnv = Object.assign(Object.create(env), {
      ANALYTICS_ENABLED: 'true',
      POSTHOG_HOST: 'https://us.i.posthog.com',
      POSTHOG_PROJECT_TOKEN: 'phc_test',
      ANALYTICS_EXCLUDED_USER_IDS: '',
    }) as Cloudflare.Env;
    await drain(await streamRuntimeTutorReply(db, analyticsEnv, userId, conversation.id, 'durable but private', {
      request: new Request('https://studyus.app/api/v1/tutor/conversations/id/messages', {
        headers: { cookie: 'studyus_session_id=session-dnt', DNT: '1' },
      }),
      execution: { waitUntil },
      analyticsOptOut: false,
      surface: '/tutor/[kcId]',
    }));

    expect(waitUntil).not.toHaveBeenCalled();
    const learner = await getLearnerAgentForUser(env, userId);
    expect((await learner.getConversation(conversation.id)).messages[0]).toMatchObject({ content: 'durable but private' });
    expect((await learner.getSnapshot()).nextAlarmAt).toBeNull();
  });

  it('leaves a standard conversation active one message below its cap', async () => {
    const conversation = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'recall' });
    const agent = await fillConversation(conversation.id, MAX_MESSAGES_PER_CONVERSATION - 3);
    mockReply();

    await drain(await streamRuntimeTutorReply(db, env, userId, conversation.id, 'one more'));

    const stored = await agent.getConversation(conversation.id);
    expect(stored.messages).toHaveLength(MAX_MESSAGES_PER_CONVERSATION - 1);
    expect(stored.status).toBe('active');
    expect(await tutorSessionEvents()).toEqual([]);
  });

  it('ends at the standard cap before atomically exposing exactly one ordered tutor_session event', async () => {
    const conversation = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'recall' });
    const agent = await fillConversation(conversation.id, MAX_MESSAGES_PER_CONVERSATION - 2);
    mockReply('The final reply.');

    const stream = await streamRuntimeTutorReply(db, env, userId, conversation.id, 'finish at cap');
    await expect(drain(stream)).resolves.toContain('"done":true');

    const stored = await agent.getConversation(conversation.id);
    const sessionEvents = await tutorSessionEvents();
    expect(stored.status).toBe('ended');
    expect(stored.activeTurnId).toBeNull();
    expect(stored.messages).toHaveLength(MAX_MESSAGES_PER_CONVERSATION);
    expect(stored.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'The final reply.' });
    expect(sessionEvents).toHaveLength(1);
    expect(sessionEvents[0]).toMatchObject({
      userId,
      kcId,
      courseId,
      type: 'tutor_session',
      isInstructional: true,
      isAssessment: true,
      source: 'tutor',
      payload: { conversation_id: conversation.id, mode: 'recall' },
    });
    expect(sessionEvents[0]!.createdAt).toBeGreaterThanOrEqual(stored.endedAt!);

    await expect(streamRuntimeTutorReply(db, env, userId, conversation.id, 'retry after cap')).rejects.toThrow(ConversationCapReachedError);
    expect(await tutorSessionEvents()).toHaveLength(1);
  });

  it('finalizes an already-at-or-over-standard-cap conversation once without contacting the model', async () => {
    const atCap = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'recall' });
    await fillConversation(atCap.id, MAX_MESSAGES_PER_CONVERSATION);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(streamRuntimeTutorReply(db, env, userId, atCap.id, 'too many')).rejects.toThrow(ConversationCapReachedError);
    await expect(streamRuntimeTutorReply(db, env, userId, atCap.id, 'retry')).rejects.toThrow(ConversationCapReachedError);

    const stored = await (await getLearnerAgentForUser(env, userId)).getConversation(atCap.id);
    expect(stored.status).toBe('ended');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await tutorSessionEvents()).toHaveLength(1);
  });

  it('uses the absorb cap independently at one below, exact, and over-cap boundaries', async () => {
    const below = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'absorb' });
    await fillConversation(below.id, MAX_MESSAGES_PER_CONVERSATION_ABSORB - 3);
    mockReply();
    await drain(await streamRuntimeTutorReply(db, env, userId, below.id, 'almost there'));
    expect((await (await getLearnerAgentForUser(env, userId)).getConversation(below.id)).status).toBe('active');

    const exact = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'absorb' });
    await fillConversation(exact.id, MAX_MESSAGES_PER_CONVERSATION_ABSORB - 2);
    mockReply();
    await drain(await streamRuntimeTutorReply(db, env, userId, exact.id, 'finish it'));
    expect((await (await getLearnerAgentForUser(env, userId)).getConversation(exact.id)).status).toBe('ended');

    const over = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'absorb' });
    await fillConversation(over.id, MAX_MESSAGES_PER_CONVERSATION_ABSORB + 1);
    await expect(streamRuntimeTutorReply(db, env, userId, over.id, 'over cap')).rejects.toThrow(ConversationCapReachedError);
    expect((await (await getLearnerAgentForUser(env, userId)).getConversation(over.id)).status).toBe('ended');

    expect(await tutorSessionEvents()).toHaveLength(2);
  });

  it('deduplicates explicit end retries and preserves the first finalized event', async () => {
    const conversation = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'recall' });

    const first = await endRuntimeConversation(db, env, userId, conversation.id, { final_rating: 4 });
    const retry = await endRuntimeConversation(db, env, userId, conversation.id, { final_rating: 1 });

    expect(retry.event.id).toBe(first.event.id);
    expect(retry.mastery_deltas).toEqual([]);
    expect((first.event.payload as Record<string, unknown>).final_rating).toBe(4);
    expect(await tutorSessionEvents()).toHaveLength(1);
  });

  it('rejects an in-flight competing turn and a cancelled stream leaves no session event', async () => {
    const conversation = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'recall' });
    const upstream = new ReadableStream<Uint8Array>({
      pull() {
        // Keep the first reply in-flight until its client cancels.
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(upstream, { status: 200 })));

    const stream = await streamRuntimeTutorReply(db, env, userId, conversation.id, 'first');
    await expect(streamRuntimeTutorReply(db, env, userId, conversation.id, 'second')).rejects.toThrow('streaming reply in progress');
    await stream.getReader().cancel();

    const stored = await (await getLearnerAgentForUser(env, userId)).getConversation(conversation.id);
    expect(stored).toMatchObject({ status: 'active', activeTurnId: null });
    expect(await tutorSessionEvents()).toEqual([]);
  });

  it('keeps a conversation active and emits no event when the upstream SSE errors', async () => {
    const conversation = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'recall' });
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('provider stream failed'));
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(upstream, { status: 200 })));

    await expect(drain(await streamRuntimeTutorReply(db, env, userId, conversation.id, 'first'))).rejects.toThrow('provider stream failed');

    const stored = await (await getLearnerAgentForUser(env, userId)).getConversation(conversation.id);
    expect(stored).toMatchObject({ status: 'active', activeTurnId: null });
    expect(await tutorSessionEvents()).toEqual([]);
  });

  it('cannot expose a tenant conversation through another learner runtime', async () => {
    const conversation = await createRuntimeConversation(db, env, userId, { kc_id: kcId, mode: 'recall' });
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'test' });

    await expect(getRuntimeConversation(db, env, otherUserId, conversation.id)).rejects.toThrow('Conversation');
  });

  it('keeps idempotency ledgers tenant-scoped even if two learner DOs receive the same conversation id', async () => {
    const sharedConversationId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const otherCourseId = crypto.randomUUID();
    const otherBranchId = crypto.randomUUID();
    const otherKcId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'test' });
    await db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'OTHER 101', slug: `other-${otherCourseId}`, title: 'Other', overview: null });
    await db.insert(branches).values({ id: otherBranchId, courseId: otherCourseId, name: 'Other branch' });
    await db.insert(kcs).values({ id: otherKcId, branchId: otherBranchId, courseId: otherCourseId, name: 'Other KC', kcType: 'fact' });
    await (await getLearnerAgentForUser(env, userId)).createConversation({ id: sharedConversationId, kcId, mode: 'recall' });
    await (await getLearnerAgentForUser(env, otherUserId)).createConversation({ id: sharedConversationId, kcId: otherKcId, mode: 'recall' });

    await endRuntimeConversation(db, env, userId, sharedConversationId, {});
    await endRuntimeConversation(db, env, otherUserId, sharedConversationId, {});

    const persisted = await db.select().from(events).where(eq(events.type, 'tutor_session'));
    expect(persisted.filter((event) => event.userId === userId)).toHaveLength(1);
    expect(persisted.filter((event) => event.userId === otherUserId)).toHaveLength(1);
  });
});
