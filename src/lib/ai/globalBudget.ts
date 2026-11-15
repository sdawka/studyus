// App-wide AI spend ceiling. Every provider attempt from every learner
// reserves one unit here before it may call OpenRouter, so self-service
// signups cannot multiply the per-learner allowance into an unbounded bill.
import { AiBudgetExceededError } from './errors';

/** Used when the var is missing or malformed: fail closed to a small budget. */
export const AI_GLOBAL_DAILY_CALL_LIMIT_FALLBACK = 500;

export function globalDailyCallLimit(env: { AI_GLOBAL_DAILY_CALL_LIMIT?: string }): number {
  const raw = env.AI_GLOBAL_DAILY_CALL_LIMIT?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : AI_GLOBAL_DAILY_CALL_LIMIT_FALLBACK;
}

/** Atomically charge one call to today's app-wide budget, or throw
 *  `global_limit`. D1 serialises writes, so the conditional upsert cannot
 *  overshoot under concurrency: a row comes back only if the increment applied. */
export async function reserveGlobalAiCall(db: D1Database, limit: number, now = Date.now()): Promise<void> {
  if (limit <= 0) throw new AiBudgetExceededError('global_limit');
  const utcDay = new Date(now).toISOString().slice(0, 10);
  const row = await db
    .prepare(
      `INSERT INTO ai_usage_global (utc_day, attempted_calls) VALUES (?1, 1)
       ON CONFLICT(utc_day) DO UPDATE SET attempted_calls = attempted_calls + 1
       WHERE attempted_calls < ?2
       RETURNING attempted_calls`,
    )
    .bind(utcDay, limit)
    .first<{ attempted_calls: number }>();
  if (!row) throw new AiBudgetExceededError('global_limit');
}
