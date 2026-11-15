import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { resolveLocalUser } from '../src/lib/auth/local-user';
import { globalDailyCallLimit, reserveGlobalAiCall, AI_GLOBAL_DAILY_CALL_LIMIT_FALLBACK } from '../src/lib/ai/globalBudget';
import { AI_DAILY_CALL_LIMIT, withLearnerAiProviderLease } from '../src/lib/runtime/learnerAgent';
import { boundPromptMessages, type ChatMessage } from '../src/lib/services/tutor/openrouter';

const db = getDb(env.DB);
const today = () => new Date().toISOString().slice(0, 10);

async function learner(label: string) {
  return (await resolveLocalUser(db, {
    id: `clerk-ai-global-${label}-${crypto.randomUUID()}`,
    primaryEmailAddress: `ai-global-${label}-${crypto.randomUUID()}@test.local`,
  })).user;
}

async function globalCalls(day = today()) {
  const row = await env.DB.prepare('SELECT attempted_calls FROM ai_usage_global WHERE utc_day = ?').bind(day).first<{ attempted_calls: number }>();
  return row?.attempted_calls ?? 0;
}

afterEach(async () => {
  await env.DB.prepare('DELETE FROM ai_usage_global').run();
});

describe('app-wide AI budget', () => {
  it('denies a fresh learner once the app-wide ceiling is spent, without provider work', async () => {
    const limit = globalDailyCallLimit(env);
    await env.DB.prepare('INSERT INTO ai_usage_global (utc_day, attempted_calls) VALUES (?, ?)').bind(today(), limit).run();
    const user = await learner('exhausted');
    let providerCalls = 0;

    await expect(withLearnerAiProviderLease(env, user.id, async () => { providerCalls++; }))
      .rejects.toMatchObject({ name: 'AiBudgetExceededError', code: 'global_limit', status: 429 });
    expect(providerCalls).toBe(0);
    expect(await globalCalls()).toBe(limit);
  });

  it('charges one global unit per provider attempt across learners', async () => {
    const a = await learner('a');
    const b = await learner('b');
    await withLearnerAiProviderLease(env, a.id, async () => 'ok');
    await withLearnerAiProviderLease(env, b.id, async () => 'ok');
    expect(await globalCalls()).toBe(2);
  });

  it('does not spend global budget on a learner already at their own daily limit', async () => {
    const user = await learner('local-cap');
    for (let i = 0; i < AI_DAILY_CALL_LIMIT; i++) await withLearnerAiProviderLease(env, user.id, async () => 'ok');
    const before = await globalCalls();
    await expect(withLearnerAiProviderLease(env, user.id, async () => 'ok')).rejects.toMatchObject({ code: 'daily_limit' });
    expect(await globalCalls()).toBe(before);
  });

  it('never overshoots the ceiling under concurrent reservations', async () => {
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => reserveGlobalAiCall(env.DB, 10)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    expect(await globalCalls()).toBe(10);
  });

  it('resets on a new UTC day', async () => {
    await reserveGlobalAiCall(env.DB, 1, Date.parse('2026-01-01T12:00:00Z'));
    await expect(reserveGlobalAiCall(env.DB, 1, Date.parse('2026-01-01T13:00:00Z'))).rejects.toMatchObject({ code: 'global_limit' });
    await expect(reserveGlobalAiCall(env.DB, 1, Date.parse('2026-01-02T00:00:01Z'))).resolves.toBeUndefined();
  });

  it('fails closed to the fallback limit when the var is missing or malformed', () => {
    expect(globalDailyCallLimit({})).toBe(AI_GLOBAL_DAILY_CALL_LIMIT_FALLBACK);
    expect(globalDailyCallLimit({ AI_GLOBAL_DAILY_CALL_LIMIT: 'lots' })).toBe(AI_GLOBAL_DAILY_CALL_LIMIT_FALLBACK);
    expect(globalDailyCallLimit({ AI_GLOBAL_DAILY_CALL_LIMIT: '0' })).toBe(0);
  });
});

describe('boundPromptMessages', () => {
  const sys: ChatMessage = { role: 'system', content: 's'.repeat(100) };
  const turn = (role: 'user' | 'assistant', n: number): ChatMessage => ({ role, content: `${role[0]}${n}`.padEnd(100, '.') });

  it('passes small prompts through unchanged', () => {
    const msgs = [sys, turn('user', 1)];
    expect(boundPromptMessages(msgs, 1000)).toBe(msgs);
  });

  it('drops the oldest turns first, keeps system and the latest, and starts history on a user turn', () => {
    const msgs = [sys, turn('user', 1), turn('assistant', 1), turn('user', 2), turn('assistant', 2), turn('user', 3)];
    const out = boundPromptMessages(msgs, 350);
    expect(out[0]).toBe(sys);
    expect(out.at(-1)).toBe(msgs.at(-1));
    expect(out[1].role).toBe('user');
    expect(out.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(350);
  });

  it('truncates when system + latest alone exceed the budget', () => {
    const out = boundPromptMessages([{ role: 'system', content: 'x'.repeat(5000) }, { role: 'user', content: 'y'.repeat(5000) }], 1000);
    expect(out).toHaveLength(2);
    expect(out.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(1000);
  });
});
