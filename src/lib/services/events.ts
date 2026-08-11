// Headless events service — the only place events are written. Every
// create/update/delete recomputes the affected KC's mastery cache in the
// same db.batch as the event mutation, so the cache is never observably
// stale relative to the log it's derived from.
import { and, desc, eq, ne } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { events, kcs } from '../../db/schema';
import type { CreateEventInput, ListEventsQuery, UpdateEventInput } from '../schemas/events';
import { EVENT_ROLE_FLAGS } from '../schemas/events';
import { toEpochMs } from '../schemas/common';
import { foldMastery } from './mastery';
import { NotFoundError, requireOwnedCourse, requireOwnedKc } from './util';
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

export async function createEvent(db: Db, userId: string, input: CreateEventInput) {
  if (input.course_id) await requireOwnedCourse(db, userId, input.course_id);
  if (input.kc_id) await requireOwnedKc(db, userId, input.kc_id);

  const { isInstructional, isAssessment } = EVENT_ROLE_FLAGS[input.type];
  const now = Date.now();
  const newEvent = {
    id: crypto.randomUUID(),
    userId,
    ts: toEpochMs(input.ts, now),
    type: input.type,
    isInstructional,
    isAssessment,
    kcId: input.kc_id ?? null,
    courseId: input.course_id ?? null,
    sessionId: null as string | null,
    payload: input.payload ?? {},
    source: 'manual' as const,
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

  return { event: newEvent, masteryDeltas };
}

export async function listEvents(db: Db, userId: string, query: ListEventsQuery) {
  if (query.course) await requireOwnedCourse(db, userId, query.course);
  if (query.kc) await requireOwnedKc(db, userId, query.kc);

  const conditions = [eq(events.userId, userId)];
  if (query.course) conditions.push(eq(events.courseId, query.course));
  if (query.kc) conditions.push(eq(events.kcId, query.kc));

  return db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.ts))
    .limit(query.limit ?? 20);
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
