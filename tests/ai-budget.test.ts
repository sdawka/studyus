import { env, runInDurableObject } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import { studySessions, users } from '../src/db/schema';
import { resolveLocalUser } from '../src/lib/auth/local-user';
import {
  AI_DAILY_CALL_LIMIT,
  getLearnerAgentForUser,
  learnerAgentObjectName,
  withLearnerAiProviderLease,
  type LearnerAgentStub,
} from '../src/lib/runtime/learnerAgent';
import { generateQuickQuiz } from '../src/lib/flows/quick_quiz';
import { branches, courses, kcs } from '../src/db/schema';

const db = getDb(env.DB);

async function activeLearner(label: string) {
  return (await resolveLocalUser(db, {
    id: `clerk-ai-budget-${label}-${crypto.randomUUID()}`,
    primaryEmailAddress: `ai-budget-${label}-${crypto.randomUUID()}@test.local`,
  })).user;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('per-learner AI provider budget', () => {
  it('counts failed provider attempts and denies the 31st without invoking provider work', async () => {
    const user = await activeLearner('daily');
    let attempted = 0;

    for (let index = 0; index < AI_DAILY_CALL_LIMIT; index++) {
      await expect(withLearnerAiProviderLease(env, user.id, async () => {
        attempted++;
        throw new Error('synthetic provider failure');
      })).rejects.toThrow('synthetic provider failure');
    }

    await expect(withLearnerAiProviderLease(env, user.id, async () => {
      attempted++;
    })).rejects.toMatchObject({ name: 'AiBudgetExceededError', code: 'daily_limit', status: 429 });
    expect(attempted).toBe(AI_DAILY_CALL_LIMIT);
  });

  it('leases one provider call at a time and releases it after failure', async () => {
    const user = await activeLearner('lease');
    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let providerCalls = 0;
    const first = withLearnerAiProviderLease(env, user.id, async () => {
      providerCalls++;
      await held;
      throw new Error('first failed');
    });

    await vi.waitFor(() => expect(providerCalls).toBe(1));
    await expect(withLearnerAiProviderLease(env, user.id, async () => {
      providerCalls++;
    })).rejects.toMatchObject({ name: 'AiBudgetExceededError', code: 'concurrent_limit', status: 409 });
    expect(providerCalls).toBe(1);

    releaseFirst();
    await expect(first).rejects.toThrow('first failed');
    await expect(withLearnerAiProviderLease(env, user.id, async () => {
      providerCalls++;
      return 'ok';
    })).resolves.toBe('ok');
    expect(providerCalls).toBe(2);
  });

  it('denies DO writes from the D1 deleting state before the tombstone job reaches the object', async () => {
    const user = await activeLearner('deletion-fence');
    const raw = env.LEARNER_AGENT.getByName(learnerAgentObjectName(user.id)) as unknown as DurableObjectStub;
    const learner = raw as unknown as LearnerAgentStub;
    await learner.initialize(user.id);
    await learner.createConversation({ id: 'kept', mode: 'recall' });
    await db.update(users).set({ accountState: 'deleting' }).where(eq(users.id, user.id));

    const response = await learner.fetch(new Request('https://learner-agent.internal/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'kept', content: 'must not persist' }),
    }));
    expect(response.status).toBe(410);
    await runInDurableObject(raw, (_instance, state) => {
      expect(state.storage.sql.exec<{ id: string }>('SELECT id FROM messages WHERE conversation_id = ?', 'kept').toArray()).toEqual([]);
    });
  });

  it('denies an over-budget runtime turn before writing its user message', async () => {
    const user = await activeLearner('runtime-denial');
    const learner = await getLearnerAgentForUser(env, user.id);
    const conversation = await learner.createConversation({ id: 'budgeted-runtime', mode: 'recall' });
    for (let index = 0; index < AI_DAILY_CALL_LIMIT; index++) {
      const reservation = await learner.tryReserveAiProviderCall();
      expect(reservation.ok).toBe(true);
      if (reservation.ok) await learner.releaseAiProviderCall(reservation.lease.id);
    }

    const response = await learner.fetch(new Request('https://learner-agent.internal/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: conversation.id, content: 'must not persist' }),
    }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'daily_limit' });
    expect(await learner.getConversation(conversation.id)).toMatchObject({ messages: [], activeTurnId: null });
  });

  it('recovers an abandoned provider lease after its bounded expiry', async () => {
    const user = await activeLearner('expired-lease');
    const raw = env.LEARNER_AGENT.getByName(learnerAgentObjectName(user.id)) as unknown as DurableObjectStub;
    const learner = await getLearnerAgentForUser(env, user.id);
    const first = await learner.tryReserveAiProviderCall();
    expect(first.ok).toBe(true);
    await runInDurableObject(raw, (_instance, state) => {
      state.storage.sql.exec('UPDATE ai_provider_lease SET expires_at = ?', Date.now() - 1);
    });

    const recovered = await learner.tryReserveAiProviderCall();
    expect(recovered).toMatchObject({ ok: true, lease: { attemptedCalls: 2 } });
    if (recovered.ok) await learner.releaseAiProviderCall(recovered.lease.id);
  });

  it('clears an abandoned accepted turn when its provider lease expires', async () => {
    const user = await activeLearner('expired-turn');
    const raw = env.LEARNER_AGENT.getByName(learnerAgentObjectName(user.id)) as unknown as DurableObjectStub;
    const learner = await getLearnerAgentForUser(env, user.id);
    await learner.createConversation({ id: 'recoverable-turn', mode: 'recall' });
    const first = await learner.fetch(new Request('https://learner-agent.internal/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'recoverable-turn', content: 'first attempt' }),
    }));
    expect(first.status).toBe(200);
    await runInDurableObject(raw, (_instance, state) => {
      state.storage.sql.exec('UPDATE ai_provider_lease SET expires_at = ?', Date.now() - 1);
    });

    const retried = await learner.fetch(new Request('https://learner-agent.internal/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'recoverable-turn', content: 'retry after client crash' }),
    }));

    expect(retried.status).toBe(200);
    const accepted = await retried.json<{ providerLeaseId: string }>();
    await learner.releaseAiProviderCall(accepted.providerLeaseId);
    expect(await learner.getConversation('recoverable-turn')).toMatchObject({ activeTurnId: expect.any(String) });
  });

  it('uses the same account allowance for AI quiz fallback and leaves no session on denial', async () => {
    const user = await activeLearner('quiz');
    const courseId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const kcId = crypto.randomUUID();
    await db.insert(courses).values({ id: courseId, userId: user.id, code: 'AI 101', slug: `ai-${courseId}`, title: 'AI budget' });
    await db.insert(branches).values({ id: branchId, courseId, name: 'Core' });
    await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Fallback topic', kcType: 'fact' });
    const learner = await getLearnerAgentForUser(env, user.id);
    for (let index = 0; index < AI_DAILY_CALL_LIMIT; index++) {
      const reservation = await learner.tryReserveAiProviderCall();
      expect(reservation.ok).toBe(true);
      if (reservation.ok) await learner.releaseAiProviderCall(reservation.lease.id);
    }
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    await expect(generateQuickQuiz(db, user.id, { kc_id: kcId }, env)).rejects.toMatchObject({
      name: 'AiBudgetExceededError',
      code: 'daily_limit',
    });
    expect(provider).not.toHaveBeenCalled();
    expect(await db.select().from(studySessions).where(eq(studySessions.userId, user.id))).toEqual([]);
  });

  it('charges the JSON compatibility retry as another provider attempt', async () => {
    const user = await activeLearner('quiz-retry');
    const courseId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const kcId = crypto.randomUUID();
    await db.insert(courses).values({ id: courseId, userId: user.id, code: 'RETRY 101', slug: `retry-${courseId}`, title: 'Retry budget' });
    await db.insert(branches).values({ id: branchId, courseId, name: 'Core' });
    await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Retry topic', kcType: 'fact' });
    const learner = await getLearnerAgentForUser(env, user.id);
    for (let index = 0; index < AI_DAILY_CALL_LIMIT - 1; index++) {
      const reservation = await learner.tryReserveAiProviderCall();
      expect(reservation.ok).toBe(true);
      if (reservation.ok) await learner.releaseAiProviderCall(reservation.lease.id);
    }
    const provider = vi.fn(async () => new Response('response_format unsupported', { status: 400 }));
    vi.stubGlobal('fetch', provider);

    await expect(generateQuickQuiz(db, user.id, { kc_id: kcId }, env)).rejects.toMatchObject({
      name: 'AiBudgetExceededError',
      code: 'daily_limit',
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await db.select().from(studySessions).where(eq(studySessions.userId, user.id))).toEqual([]);
  });
});
