// Headless events service — the only place events are written. Every
// create/update/delete recomputes the affected KC's mastery cache in the
// same db.batch as the event mutation, so the cache is never observably
// stale relative to the log it's derived from.
import { and, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import { events, kcs, runtimeTutorSessionEvents } from '../../db/schema';
import type { CreateEventInput, EventSource, ListEventsQuery, UpdateEventInput } from '../schemas/events';
import { EVENT_ROLE_FLAGS } from '../schemas/events';
import { toEpochMs } from '../schemas/common';
import { foldMastery } from './mastery';
import { ConflictError, NotFoundError, requireOwnedCourse, requireOwnedKc } from './util';
import { withSpan } from '../tracing';

type EventRow = typeof events.$inferSelect;

export type MasteryDelta = { kc_id: string; old_mastery: number; new_mastery: number };

async function foldedKcUpdate(db: Db, kcId: string, eventsForFold: Array<Pick<EventRow, 'ts' | 'isInstructional' | 'isAssessment' | 'payload'>>) {
  const before = await db.select({ mastery: kcs.mastery }).from(kcs).where(eq(kcs.id, kcId)).limit(1);
  const oldMastery = before[0]?.mastery ?? 0;

  const folded = await withSpan('mastery.fold', { kc_id: kcId, event_count: eventsForFold.length }, async () =>
    foldMastery(eventsForFold, Date.now()),
  );

  const updateStmt = db
    .update(kcs)
    .set({ mastery: folded.mastery, status: folded.status, lastEventAt: folded.lastEventAt })
    .where(eq(kcs.id, kcId));
  const delta: MasteryDelta = { kc_id: kcId, old_mastery: oldMastery, new_mastery: folded.mastery };
  return { updateStmt, delta };
}

// `source` defaults to 'manual' (the only source POST /events itself ever
// creates — that route's caller never passes it); tutor/quiz flows pass
// 'tutor'/'seed' explicitly. PATCH /events/:id keeps gating on
// `source === 'manual'` regardless of what this created the row with.
type CreateEventWithOptionalId = CreateEventInput & { event_id?: string };

export async function createEvent(db: Db, userId: string, input: CreateEventWithOptionalId, source: EventSource = 'manual') {
  if (input.course_id) await requireOwnedCourse(db, userId, input.course_id);
  if (input.kc_id) await requireOwnedKc(db, userId, input.kc_id);

  // Engine calls can be delivered at-least-once. A supplied event id is an
  // idempotency key: the exact same learner fact is returned without
  // refolding mastery; an id owned by somebody else is never disclosed.
  if (input.event_id) {
    const existing = await db.select().from(events).where(eq(events.id, input.event_id)).limit(1);
    if (existing[0]) {
      if (existing[0].userId !== userId) throw new NotFoundError('Event');
      if (existing[0].type !== input.type || existing[0].kcId !== (input.kc_id ?? null)) {
        throw new ConflictError('Event id is already bound to different evidence');
      }
      return { event: existing[0], masteryDeltas: [], wasCreated: false };
    }
  }

  const { isInstructional, isAssessment } = EVENT_ROLE_FLAGS[input.type];
  const now = Date.now();
  const newEvent = {
    id: input.event_id ?? crypto.randomUUID(),
    userId,
    ts: toEpochMs(input.ts, now),
    type: input.type,
    isInstructional,
    isAssessment,
    kcId: input.kc_id ?? null,
    courseId: input.course_id ?? null,
    sessionId: null as string | null,
    payload: input.payload ?? {},
    source,
    createdAt: now,
  };

  const insertStmt = db.insert(events).values(newEvent);
  const masteryDeltas: MasteryDelta[] = [];

  if (newEvent.kcId) {
    const existing = await db
      .select({ ts: events.ts, isInstructional: events.isInstructional, isAssessment: events.isAssessment, payload: events.payload })
      .from(events)
      .where(eq(events.kcId, newEvent.kcId));
    const { updateStmt, delta } = await foldedKcUpdate(db, newEvent.kcId, [...existing, newEvent]);
    masteryDeltas.push(delta);
    await withSpan('events.append', { event_type: newEvent.type, kc_id: newEvent.kcId }, () => db.batch([insertStmt, updateStmt]));
  } else {
    await withSpan('events.append', { event_type: newEvent.type }, () => insertStmt);
  }

  return { event: newEvent, masteryDeltas, wasCreated: true };
}

export type AtomicEventInput = CreateEventInput & {
  event_id?: string;
  session_id?: string;
};

/**
 * Appends a related set of domain events together with caller-owned state
 * transitions in one D1 batch. Every affected KC is folded exactly once with
 * the complete new event set included. This is the composition boundary for
 * study-session finalization: sessions owns its rows, while this service
 * remains the sole writer of the events table and mastery cache.
 */
export async function appendEventsAtomically(
  db: Db,
  userId: string,
  inputs: AtomicEventInput[],
  source: EventSource,
  companionStatements: BatchItem<'sqlite'>[],
) {
  for (const input of inputs) {
    if (input.course_id) await requireOwnedCourse(db, userId, input.course_id);
    if (input.kc_id) await requireOwnedKc(db, userId, input.kc_id);
  }

  const now = Date.now();
  const newEvents: EventRow[] = inputs.map((input) => {
    const { isInstructional, isAssessment } = EVENT_ROLE_FLAGS[input.type];
    return {
      id: input.event_id ?? crypto.randomUUID(),
      userId,
      ts: toEpochMs(input.ts, now),
      type: input.type,
      isInstructional,
      isAssessment,
      kcId: input.kc_id ?? null,
      courseId: input.course_id ?? null,
      sessionId: input.session_id ?? null,
      payload: input.payload ?? {},
      source,
      createdAt: now,
    };
  });

  const statements: BatchItem<'sqlite'>[] = [...companionStatements];
  if (newEvents.length > 0) statements.push(db.insert(events).values(newEvents));

  const masteryDeltas: MasteryDelta[] = [];
  const kcIds = [...new Set(newEvents.flatMap((event) => (event.kcId ? [event.kcId] : [])))];
  for (const kcId of kcIds) {
    const existing = await db
      .select({ ts: events.ts, isInstructional: events.isInstructional, isAssessment: events.isAssessment, payload: events.payload })
      .from(events)
      .where(eq(events.kcId, kcId));
    const additions = newEvents.filter((event) => event.kcId === kcId);
    const { updateStmt, delta } = await foldedKcUpdate(db, kcId, [...existing, ...additions]);
    statements.push(updateStmt);
    masteryDeltas.push(delta);
  }

  if (statements.length === 0) return { events: newEvents, masteryDeltas };
  await withSpan('events.append_atomic', { event_count: newEvents.length, kc_count: kcIds.length }, () =>
    db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]),
  );
  return { events: newEvents, masteryDeltas };
}

/**
 * Persist the one terminal domain event associated with a Durable Object tutor
 * conversation. The unique conversation ledger and D1 batch make the event,
 * mastery cache update, and idempotency record one atomic D1 operation.
 *
 * The Durable Object owns the transcript and its ended state; this function
 * owns only the D1 learner-model consequence of that finalized state.
 */
export async function createRuntimeTutorSessionEvent(
  db: Db,
  userId: string,
  input: { conversationId: string; kcId: string; courseId: string; mode: string; finalRating?: number },
) {
  const existing = await db
    .select({ event: events })
    .from(runtimeTutorSessionEvents)
    .innerJoin(events, eq(runtimeTutorSessionEvents.eventId, events.id))
    .where(and(eq(runtimeTutorSessionEvents.conversationId, input.conversationId), eq(runtimeTutorSessionEvents.userId, userId)))
    .limit(1);
  if (existing[0]) return { event: existing[0].event, masteryDeltas: [] as MasteryDelta[] };

  await requireOwnedKc(db, userId, input.kcId);
  await requireOwnedCourse(db, userId, input.courseId);

  const now = Date.now();
  const payload: Record<string, unknown> = { conversation_id: input.conversationId, mode: input.mode };
  if (input.finalRating !== undefined) payload.final_rating = input.finalRating;
  const newEvent = {
    id: crypto.randomUUID(),
    userId,
    ts: now,
    type: 'tutor_session' as const,
    isInstructional: true,
    isAssessment: true,
    kcId: input.kcId,
    courseId: input.courseId,
    sessionId: null,
    payload,
    source: 'tutor' as const,
    createdAt: now,
  };
  const existingEvents = await db
    .select({ ts: events.ts, isInstructional: events.isInstructional, isAssessment: events.isAssessment, payload: events.payload })
    .from(events)
    .where(eq(events.kcId, input.kcId));
  const { updateStmt, delta } = await foldedKcUpdate(db, input.kcId, [...existingEvents, newEvent]);

  try {
    await withSpan('events.append_runtime_tutor_session', { kc_id: input.kcId }, () =>
      db.batch([
        db.insert(events).values(newEvent),
        updateStmt,
        db.insert(runtimeTutorSessionEvents).values({
          conversationId: input.conversationId,
          userId,
          eventId: newEvent.id,
          createdAt: now,
        }),
      ]),
    );
    return { event: newEvent, masteryDeltas: [delta] };
  } catch (error) {
    // A concurrent stream completion / explicit-end retry lost the unique
    // ledger race. Its D1 batch rolled back, so returning the winner is safe.
    const settled = await db
      .select({ event: events })
      .from(runtimeTutorSessionEvents)
      .innerJoin(events, eq(runtimeTutorSessionEvents.eventId, events.id))
      .where(and(eq(runtimeTutorSessionEvents.conversationId, input.conversationId), eq(runtimeTutorSessionEvents.userId, userId)))
      .limit(1);
    if (settled[0]) return { event: settled[0].event, masteryDeltas: [] as MasteryDelta[] };
    throw error;
  }
}

export async function listEvents(db: Db, userId: string, query: ListEventsQuery) {
  if (query.course) await requireOwnedCourse(db, userId, query.course);
  if (query.kc) await requireOwnedKc(db, userId, query.kc);

  const conditions = [eq(events.userId, userId)];
  if (query.course) conditions.push(eq(events.courseId, query.course));
  if (query.kc) conditions.push(eq(events.kcId, query.kc));
  if (query.from) conditions.push(gte(events.ts, toEpochMs(query.from)));
  if (query.to) conditions.push(lte(events.ts, toEpochMs(query.to)));
  if (query.types) conditions.push(inArray(events.type, query.types));

  const rows = await db
    .select({ event: events, kcName: kcs.name })
    .from(events)
    .leftJoin(kcs, eq(events.kcId, kcs.id))
    .where(and(...conditions))
    .orderBy(desc(events.ts))
    .limit(query.limit ?? 20);

  return rows.map((r) => ({ ...r.event, kcName: r.kcName }));
}

export async function getKcEvents(db: Db, userId: string, kcId: string, opts: { limit?: number; offset?: number } = {}) {
  await requireOwnedKc(db, userId, kcId);
  return db
    .select()
    .from(events)
    .where(eq(events.kcId, kcId))
    .orderBy(desc(events.ts))
    .limit(opts.limit ?? 20)
    .offset(opts.offset ?? 0);
}

async function requireOwnedEvent(db: Db, userId: string, eventId: string): Promise<EventRow> {
  const rows = await db.select().from(events).where(and(eq(events.id, eventId), eq(events.userId, userId))).limit(1);
  const event = rows[0];
  if (!event) throw new NotFoundError('Event');
  return event;
}

export class NotManualEventError extends Error {
  constructor() {
    super('Only manually-recorded events can be edited; system events are delete-only');
    this.name = 'NotManualEventError';
  }
}

// PATCH is manual-source only (typo correction). DELETE (below) allows any
// source — system-generated events are delete-only, confirmed by the client.
export async function updateEvent(db: Db, userId: string, eventId: string, input: UpdateEventInput) {
  const existingEvent = await requireOwnedEvent(db, userId, eventId);
  if (existingEvent.source !== 'manual') {
    throw new NotManualEventError();
  }

  const now = Date.now();
  const nextType = input.type ?? (existingEvent.type as CreateEventInput['type']);
  const roleFlags = EVENT_ROLE_FLAGS[nextType];
  const updated: EventRow = {
    ...existingEvent,
    type: nextType,
    isInstructional: roleFlags.isInstructional,
    isAssessment: roleFlags.isAssessment,
    payload: input.payload ?? existingEvent.payload,
    ts: input.ts ? toEpochMs(input.ts, now) : existingEvent.ts,
  };

  const updateEventStmt = db
    .update(events)
    .set({ type: updated.type, isInstructional: updated.isInstructional, isAssessment: updated.isAssessment, payload: updated.payload, ts: updated.ts })
    .where(eq(events.id, eventId));

  const masteryDeltas: MasteryDelta[] = [];
  if (existingEvent.kcId) {
    // Re-fold with every other event for this KC plus the updated version of this one.
    const others = await db
      .select({ ts: events.ts, isInstructional: events.isInstructional, isAssessment: events.isAssessment, payload: events.payload })
      .from(events)
      .where(and(eq(events.kcId, existingEvent.kcId), eq(events.userId, userId), ne(events.id, eventId)));
    const { updateStmt, delta } = await foldedKcUpdate(db, existingEvent.kcId, [...others, updated]);
    masteryDeltas.push(delta);
    await db.batch([updateEventStmt, updateStmt]);
  } else {
    await updateEventStmt;
  }

  return { event: updated, masteryDeltas };
}

export async function deleteEvent(db: Db, userId: string, eventId: string) {
  const existingEvent = await requireOwnedEvent(db, userId, eventId);
  const deleteStmt = db.delete(events).where(eq(events.id, eventId));

  const masteryDeltas: MasteryDelta[] = [];
  if (existingEvent.kcId) {
    // Re-fold with everything *except* the event being deleted.
    const remaining = await db
      .select({ ts: events.ts, isInstructional: events.isInstructional, isAssessment: events.isAssessment, payload: events.payload })
      .from(events)
      .where(and(eq(events.kcId, existingEvent.kcId), eq(events.userId, userId), ne(events.id, eventId)));
    const { updateStmt, delta } = await foldedKcUpdate(db, existingEvent.kcId, remaining);
    masteryDeltas.push(delta);
    await db.batch([deleteStmt, updateStmt]);
  } else {
    await deleteStmt;
  }

  return { masteryDeltas };
}
