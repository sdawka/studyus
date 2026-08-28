// Study sessions. Completing a session appends one event per touched KC via
// the events service — using the session's intended_event_type when it maps
// to a known EVENT_TYPE, falling back to 'practice_done' (dual-role) so a
// session always registers as at least some evidence of study.
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { calendarConnections, sessionKcs, studySessions } from '../../db/schema';
import type { CompleteStudySessionInput, CreateStudySessionInput, ListSessionsQuery, UpdateSessionInput } from '../schemas/sessions';
import { EVENT_TYPES, type EventType } from '../schemas/events';
import { toEpochMs } from '../schemas/common';
import { createEvent } from './events';
import { enqueueCalendarOperation } from './calendarSync';
import { requireOwnedRitual } from './rituals';
import { ConflictError, NotFoundError, requireOwnedCourse } from './util';

function resolveEventType(intended: string): EventType {
  return (EVENT_TYPES as readonly string[]).includes(intended) ? (intended as EventType) : 'practice_done';
}

async function enqueueSessionChange(
  db: Db,
  userId: string,
  sessionId: string,
  action: 'upsert' | 'delete',
  revision: string,
) {
  const connections = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.status, 'active'),
        eq(calendarConnections.syncMode, 'controlled'),
      ),
    );
  await Promise.all(
    connections.map((connection) =>
      enqueueCalendarOperation(db, userId, connection.id, {
        action,
        entity_type: 'study_session',
        entity_id: sessionId,
        revision,
      }),
    ),
  );
}

function sessionRevision(session: typeof studySessions.$inferSelect): string {
  return `${session.scheduledAt ?? 'unscheduled'}:${session.plannedMinutes ?? 'default'}`;
}

export async function createSession(db: Db, userId: string, input: CreateStudySessionInput) {
  if (input.course_id) await requireOwnedCourse(db, userId, input.course_id);
  // v1.9: session-shape ritual picked at session start — reject a ritual_id
  // that isn't the caller's own (same NotFoundError-on-mismatch pattern as
  // course_id above) rather than silently stamping someone else's ritual.
  if (input.ritual_id) await requireOwnedRitual(db, userId, input.ritual_id);

  const id = crypto.randomUUID();
  const scheduledAt = input.scheduled_at ? toEpochMs(input.scheduled_at) : null;
  // A planned session has no "started" moment yet, but started_at is
  // NOT NULL — stamp it with the scheduled time too so ordering and the
  // calendar's COALESCE(scheduled_at, started_at) both land on the same value.
  const startedAt = scheduledAt ?? Date.now();
  await db.insert(studySessions).values({
    id,
    userId,
    courseId: input.course_id ?? null,
    intendedEventType: input.intended_event_type,
    plannedMinutes: input.planned_minutes ?? null,
    startedAt,
    scheduledAt,
    ritualId: input.ritual_id ?? null,
  });

  if (input.kc_ids?.length) {
    await db.insert(sessionKcs).values(input.kc_ids.map((kcId) => ({ id: crypto.randomUUID(), studySessionId: id, kcId })));
  }

  const rows = await db.select().from(studySessions).where(eq(studySessions.id, id)).limit(1);
  if (rows[0]?.scheduledAt != null) {
    await enqueueSessionChange(db, userId, id, 'upsert', sessionRevision(rows[0]));
  }
  return rows[0];
}

export async function listSessions(db: Db, userId: string, query: ListSessionsQuery) {
  const conditions = [eq(studySessions.userId, userId)];
  if (query.course) conditions.push(eq(studySessions.courseId, query.course));
  // Range over COALESCE(scheduled_at, started_at), matching the calendar's
  // windowing of study sessions.
  if (query.from) conditions.push(sql`coalesce(${studySessions.scheduledAt}, ${studySessions.startedAt}) >= ${toEpochMs(query.from)}`);
  if (query.to) conditions.push(sql`coalesce(${studySessions.scheduledAt}, ${studySessions.startedAt}) <= ${toEpochMs(query.to)}`);
  return db.select().from(studySessions).where(and(...conditions));
}

async function requireOwnedSession(db: Db, userId: string, sessionId: string) {
  const rows = await db.select().from(studySessions).where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId))).limit(1);
  const session = rows[0];
  if (!session) throw new NotFoundError('Study session');
  return session;
}

export async function completeSession(db: Db, userId: string, sessionId: string, input: CompleteStudySessionInput) {
  const session = await requireOwnedSession(db, userId, sessionId);

  const patch: Partial<typeof studySessions.$inferInsert> = {
    endedAt: toEpochMs(input.ended_at),
    reflection: input.reflection ?? null,
  };
  if (input.scheduled_at) patch.scheduledAt = toEpochMs(input.scheduled_at);

  await db.update(studySessions).set(patch).where(eq(studySessions.id, sessionId));

  const touchedKcIds = input.kc_ids_touched?.length
    ? input.kc_ids_touched
    : (await db.select().from(sessionKcs).where(eq(sessionKcs.studySessionId, sessionId))).map((r) => r.kcId);

  const eventType = resolveEventType(session.intendedEventType);
  const eventsAppended = [];
  const masteryDeltas = [];

  for (const kcId of touchedKcIds) {
    const { event, masteryDeltas: deltas } = await createEvent(
      db,
      userId,
      {
        type: eventType,
        kc_id: kcId,
        course_id: session.courseId ?? undefined,
        payload: { session_id: sessionId },
      },
      'session',
    );
    eventsAppended.push(event);
    masteryDeltas.push(...deltas);
  }

  return { id: sessionId, events_appended: eventsAppended, mastery_deltas: masteryDeltas };
}

// v1.6: reschedule a still-planned session (PATCH /sessions/:id). Rejects
// once the session is completed (ended_at set) — a completed session's
// time/duration is history, not a plan to move; distinct from
// completeSession's own optional `scheduled_at` (used to record what a
// session that's finishing right now was actually rescheduled to earlier).
export async function updateSession(db: Db, userId: string, sessionId: string, input: UpdateSessionInput) {
  const session = await requireOwnedSession(db, userId, sessionId);
  if (session.endedAt) throw new ConflictError('Study session already completed');

  const patch: Partial<typeof studySessions.$inferInsert> = {};
  if (input.scheduled_at !== undefined) patch.scheduledAt = toEpochMs(input.scheduled_at);
  if (input.planned_minutes !== undefined) patch.plannedMinutes = input.planned_minutes;

  if (Object.keys(patch).length > 0) {
    await db.update(studySessions).set(patch).where(eq(studySessions.id, sessionId));
  }

  const rows = await db.select().from(studySessions).where(eq(studySessions.id, sessionId)).limit(1);
  if (rows[0]?.scheduledAt != null) {
    await enqueueSessionChange(db, userId, sessionId, 'upsert', sessionRevision(rows[0]));
  }
  return rows[0];
}

// v1.6: hard delete, ownership-checked — closes the sessions-DELETE
// deferral (docs/todo.md).
export async function deleteSession(db: Db, userId: string, sessionId: string): Promise<void> {
  const session = await requireOwnedSession(db, userId, sessionId);
  await enqueueSessionChange(db, userId, sessionId, 'delete', `deleted:${sessionRevision(session)}`);
  await db.delete(studySessions).where(eq(studySessions.id, sessionId));
}
