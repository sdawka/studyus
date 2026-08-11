// Study sessions. Completing a session appends one event per touched KC via
// the events service — using the session's intended_event_type when it maps
// to a known EVENT_TYPE, falling back to 'practice_done' (dual-role) so a
// session always registers as at least some evidence of study.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { sessionKcs, studySessions } from '../../db/schema';
import type { CompleteStudySessionInput, CreateStudySessionInput, ListSessionsQuery } from '../schemas/sessions';
import { EVENT_TYPES, type EventType } from '../schemas/events';
import { toEpochMs } from '../schemas/common';
import { createEvent } from './events';
import { NotFoundError, requireOwnedCourse } from './util';

function resolveEventType(intended: string): EventType {
  return (EVENT_TYPES as readonly string[]).includes(intended) ? (intended as EventType) : 'practice_done';
}

export async function createSession(db: Db, userId: string, input: CreateStudySessionInput) {
  if (input.course_id) await requireOwnedCourse(db, userId, input.course_id);

  const id = crypto.randomUUID();
  const startedAt = Date.now();
  await db.insert(studySessions).values({
    id,
    userId,
    courseId: input.course_id ?? null,
    intendedEventType: input.intended_event_type,
    plannedMinutes: input.planned_minutes ?? null,
    startedAt,
  });

  if (input.kc_ids?.length) {
    await db.insert(sessionKcs).values(input.kc_ids.map((kcId) => ({ id: crypto.randomUUID(), studySessionId: id, kcId })));
  }

  const rows = await db.select().from(studySessions).where(eq(studySessions.id, id)).limit(1);
  return rows[0];
}

export async function listSessions(db: Db, userId: string, query: ListSessionsQuery) {
  const conditions = [eq(studySessions.userId, userId)];
  if (query.course) conditions.push(eq(studySessions.courseId, query.course));
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

  await db
    .update(studySessions)
    .set({ endedAt: toEpochMs(input.ended_at), reflection: input.reflection ?? null })
    .where(eq(studySessions.id, sessionId));

  const touchedKcIds = input.kc_ids_touched?.length
    ? input.kc_ids_touched
    : (await db.select().from(sessionKcs).where(eq(sessionKcs.studySessionId, sessionId))).map((r) => r.kcId);

  const eventType = resolveEventType(session.intendedEventType);
  const eventsAppended = [];
  const masteryDeltas = [];

  for (const kcId of touchedKcIds) {
    const { event, masteryDeltas: deltas } = await createEvent(db, userId, {
      type: eventType,
      kc_id: kcId,
      course_id: session.courseId ?? undefined,
      payload: { session_id: sessionId },
    });
    eventsAppended.push(event);
    masteryDeltas.push(...deltas);
  }

  return { id: sessionId, events_appended: eventsAppended, mastery_deltas: masteryDeltas };
}
