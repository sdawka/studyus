import { count, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { demoFunnelEvents } from '../../db/schema';
import { behavioralEventSchema, type BehavioralEvent } from '../analytics/events';
import type { DemoFunnelBatchInput } from '../schemas/onboarding';

const MAX_SESSION_EVENTS = 100;
const EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type InsertedDemoFunnelEvent = typeof demoFunnelEvents.$inferSelect;

export async function insertDemoFunnelBatch(db: Db, body: DemoFunnelBatchInput, now = Date.now()) {
  const recent = body.events
    .filter((event) => Math.abs(now - event.occurred_at) <= EVENT_MAX_AGE_MS)
    .map((event) => ({
      id: event.event_id,
      sessionId: event.session_id,
      name: event.name,
      step: event.step,
      scenarioId: event.scenario_id,
      occurredAt: event.occurred_at,
      createdAt: now,
    }));
  const sessions = [...new Set(recent.map((event) => event.sessionId))];
  const existingCounts = new Map(
    await Promise.all(
      sessions.map(async (sessionId) => {
        const [row] = await db.select({ total: count() }).from(demoFunnelEvents).where(eq(demoFunnelEvents.sessionId, sessionId));
        return [sessionId, row?.total ?? 0] as const;
      }),
    ),
  );
  const accepted = recent.filter((event) => {
    const used = existingCounts.get(event.sessionId) ?? 0;
    if (used >= MAX_SESSION_EVENTS) return false;
    existingCounts.set(event.sessionId, used + 1);
    return true;
  });
  const inserted = accepted.length
    ? await db.insert(demoFunnelEvents).values(accepted).onConflictDoNothing().returning()
    : [];
  return { accepted: accepted.length, inserted };
}

function surfaceFor(name: string): '/try' | '/onboarding' {
  return name === 'import_offered' || name === 'import_accepted' || name === 'import_declined' || name === 'onboarding_completed'
    ? '/onboarding'
    : '/try';
}

export function demoRowsToBehavioralEvents(
  rows: readonly InsertedDemoFunnelEvent[],
  appSessionId: string | undefined,
): BehavioralEvent[] {
  if (!appSessionId) return [];
  return rows.flatMap((row) => {
    const result = behavioralEventSchema.safeParse({
      name: row.name,
      session_id: appSessionId,
      surface: surfaceFor(row.name),
      ts: row.occurredAt,
      trial_session_id: row.sessionId,
      ...(row.step ? { step: row.step } : {}),
      ...(row.scenarioId ? { scenario_id: row.scenarioId } : {}),
    });
    return result.success ? [result.data] : [];
  });
}
