import { lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { demoFunnelEvents } from '../../db/schema';
import { behavioralEventSchema, type BehavioralEvent } from '../analytics/events';
import type { DemoFunnelBatchInput } from '../schemas/onboarding';

const MAX_SESSION_EVENTS = 100;
const EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETENTION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type InsertedDemoFunnelEvent = typeof demoFunnelEvents.$inferSelect;

export async function pruneDemoFunnel(db: Db, now = Date.now()) {
  await db.delete(demoFunnelEvents).where(lt(demoFunnelEvents.createdAt, now - RETENTION_AGE_MS));
}

export async function insertDemoFunnelBatch(db: Db, body: DemoFunnelBatchInput, now = Date.now()) {
  await pruneDemoFunnel(db, now);
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
  if (recent.length === 0) return { accepted: 0, inserted: [] as InsertedDemoFunnelEvent[] };

  // Each insert performs the count check in the same SQLite statement as its
  // write. D1 executes the batch transactionally and in order, so concurrent
  // requests cannot both reserve the same remaining per-session capacity.
  // RETURNING also makes the response count actual inserts: replays and rows
  // refused at the cap never appear as accepted.
  const statements = recent.map((event) =>
    db
      .insert(demoFunnelEvents)
      .select(sql`
        select
          ${event.id},
          ${event.sessionId},
          ${event.name},
          ${event.step ?? null},
          ${event.scenarioId ?? null},
          ${event.occurredAt},
          ${event.createdAt}
        where (
          select count(*)
          from ${demoFunnelEvents}
          where ${demoFunnelEvents.sessionId} = ${event.sessionId}
        ) < ${MAX_SESSION_EVENTS}
      `)
      .onConflictDoNothing()
      .returning(),
  );
  const results = await db.batch(statements as [typeof statements[number], ...typeof statements]);
  const inserted = results.flat() as InsertedDemoFunnelEvent[];
  return { accepted: inserted.length, inserted };
}

function surfaceFor(name: string): '/try' | '/onboarding' {
  return name === 'import_offered' || name === 'import_accepted' || name === 'import_declined'
    ? '/onboarding'
    : '/try';
}

export function demoRowsToBehavioralEvents(
  rows: readonly InsertedDemoFunnelEvent[],
  appSessionId: string | undefined,
): BehavioralEvent[] {
  if (!appSessionId) return [];
  return [...rows].sort((left, right) => left.occurredAt - right.occurredAt).flatMap((row) => {
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
