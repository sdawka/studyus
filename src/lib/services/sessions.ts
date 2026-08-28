// Study sessions. Completing a session appends one event per touched KC via
// the events service — using the session's intended_event_type when it maps
// to a known EVENT_TYPE, falling back to 'practice_done' (dual-role) so a
// session always registers as at least some evidence of study.
import { and, asc, eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import { calendarConnections, events, sessionKcs, studySessionFinalizations, studySessions } from '../../db/schema';
import type {
  CompleteStudySessionInput,
  CreateStudySessionInput,
  DiscardStudySessionInput,
  ListSessionsQuery,
  UpdateSessionInput,
} from '../schemas/sessions';
import { EVENT_ROLE_FLAGS, EVENT_TYPES, type EventType } from '../schemas/events';
import { toEpochMs } from '../schemas/common';
import { appendEventsAtomically, type AtomicEventInput } from './events';
import { enqueueCalendarOperation } from './calendarSync';
import { requireOwnedRitual } from './rituals';
import { ConflictError, NotFoundError, requireOwnedCourse, requireOwnedKc } from './util';

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

  const kcIds = [...new Set(input.kc_ids ?? [])];
  await requireSessionKcs(db, userId, input.course_id ?? null, kcIds);

  const id = crypto.randomUUID();
  const scheduledAt = input.scheduled_at ? toEpochMs(input.scheduled_at) : null;
  // A planned session has no "started" moment yet, but started_at is
  // NOT NULL — stamp it with the scheduled time too so ordering and the
  // calendar's COALESCE(scheduled_at, started_at) both land on the same value.
  const startedAt = scheduledAt ?? Date.now();
  const insertSession = db.insert(studySessions).values({
    id,
    userId,
    courseId: input.course_id ?? null,
    intendedEventType: input.intended_event_type,
    plannedMinutes: input.planned_minutes ?? null,
    startedAt,
    scheduledAt,
    ritualId: input.ritual_id ?? null,
  });
  if (kcIds.length > 0) {
    await db.batch([
      insertSession,
      db.insert(sessionKcs).values(kcIds.map((kcId) => ({ id: crypto.randomUUID(), studySessionId: id, kcId }))),
    ]);
  } else {
    await insertSession;
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
  const rows = await db
    .select({ session: studySessions, disposition: studySessionFinalizations.disposition })
    .from(studySessions)
    .leftJoin(studySessionFinalizations, eq(studySessionFinalizations.studySessionId, studySessions.id))
    .where(and(...conditions));
  return rows.map(({ session, disposition }) => ({
    ...session,
    disposition: disposition ?? (session.endedAt !== null ? ('completed' as const) : null),
  }));
}

async function requireOwnedSession(db: Db, userId: string, sessionId: string) {
  const rows = await db.select().from(studySessions).where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId))).limit(1);
  const session = rows[0];
  if (!session) throw new NotFoundError('Study session');
  return session;
}

type SessionDisposition = 'completed' | 'discarded';

async function requireSessionKcs(db: Db, userId: string, courseId: string | null, kcIds: string[]) {
  const byId = new Map<string, Awaited<ReturnType<typeof requireOwnedKc>>>();
  for (const kcId of kcIds) {
    const kc = await requireOwnedKc(db, userId, kcId);
    if (courseId && kc.courseId !== courseId) throw new NotFoundError('KC');
    byId.set(kcId, kc);
  }
  return byId;
}

async function existingFinalizationResult(
  db: Db,
  userId: string,
  session: typeof studySessions.$inferSelect,
  requested: SessionDisposition,
) {
  const rows = await db
    .select()
    .from(studySessionFinalizations)
    .where(eq(studySessionFinalizations.studySessionId, session.id))
    .limit(1);
  const finalization = rows[0];

  // All ended rows are backfilled by migration 0010. This fallback keeps
  // direct test/legacy inserts safe if they predate that ledger row.
  const settledDisposition = finalization?.disposition ?? (session.endedAt !== null ? 'completed' : null);
  if (!settledDisposition) return null;
  if (settledDisposition !== requested) {
    throw new ConflictError(`Study session already ${settledDisposition}`);
  }

  const canonicalEvents = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.sessionId, session.id)))
    .orderBy(asc(events.createdAt), asc(events.id));
  return {
    id: session.id,
    disposition: settledDisposition,
    endedAt: finalization?.finalizedAt ?? session.endedAt!,
    eventsAppended: canonicalEvents,
    masteryDeltas: [],
    alreadyFinalized: true,
  };
}

async function finalizeSession(
  db: Db,
  userId: string,
  sessionId: string,
  disposition: SessionDisposition,
  input: CompleteStudySessionInput | DiscardStudySessionInput,
) {
  const session = await requireOwnedSession(db, userId, sessionId);
  if (session.intendedEventType === 'quick_quiz') {
    throw new ConflictError('Quick quizzes must be finalized through quiz grading');
  }

  const settled = await existingFinalizationResult(db, userId, session, disposition);
  if (settled) return settled;

  const finalizedAt = toEpochMs(input.ended_at);
  const companionStatements: BatchItem<'sqlite'>[] = [
    db.insert(studySessionFinalizations).values({
      studySessionId: sessionId,
      disposition,
      finalizedAt,
      createdAt: Date.now(),
    }),
  ];

  const eventInputs: AtomicEventInput[] = [];
  if (disposition === 'completed') {
    const completion = input as CompleteStudySessionInput;
    const storedLinks = await db.select().from(sessionKcs).where(eq(sessionKcs.studySessionId, sessionId));
    const storedIds = storedLinks.map((link) => link.kcId);
    const outcomes: Array<{ kc_id: string; self_rating?: number }> = completion.kc_outcomes !== undefined
      ? completion.kc_outcomes
      : completion.kc_ids_touched !== undefined
        ? [...new Set(completion.kc_ids_touched)].map((kcId) => ({ kc_id: kcId }))
        : storedIds.map((kcId) => ({ kc_id: kcId }));
    const kcById = await requireSessionKcs(db, userId, session.courseId, outcomes.map((outcome) => outcome.kc_id));

    const patch: Partial<typeof studySessions.$inferInsert> = {
      endedAt: finalizedAt,
      reflection: completion.reflection ?? null,
    };
    if (completion.scheduled_at) patch.scheduledAt = toEpochMs(completion.scheduled_at);
    companionStatements.push(db.update(studySessions).set(patch).where(eq(studySessions.id, sessionId)));

    const linkedIds = new Set(storedIds);
    const missingIds = outcomes.map((outcome) => outcome.kc_id).filter((kcId) => !linkedIds.has(kcId));
    if (missingIds.length > 0) {
      companionStatements.push(
        db.insert(sessionKcs).values(missingIds.map((kcId) => ({ id: crypto.randomUUID(), studySessionId: sessionId, kcId }))),
      );
    }

    const eventType = resolveEventType(session.intendedEventType);
    const intendedIsAssessment = EVENT_ROLE_FLAGS[eventType].isAssessment;
    for (const outcome of outcomes) {
      const courseId = session.courseId ?? kcById.get(outcome.kc_id)!.courseId;
      const payload: Record<string, unknown> = { session_id: sessionId };
      if (intendedIsAssessment && outcome.self_rating !== undefined) payload.self_rating = outcome.self_rating;
      eventInputs.push({
        type: eventType,
        kc_id: outcome.kc_id,
        course_id: courseId,
        session_id: sessionId,
        payload,
      });
      if (!intendedIsAssessment && outcome.self_rating !== undefined) {
        eventInputs.push({
          type: 'self_assessment',
          kc_id: outcome.kc_id,
          course_id: courseId,
          session_id: sessionId,
          payload: { session_id: sessionId, self_rating: outcome.self_rating },
        });
      }
    }
  } else {
    companionStatements.push(
      db.update(studySessions).set({ endedAt: finalizedAt }).where(eq(studySessions.id, sessionId)),
    );
  }

  try {
    const committed = await appendEventsAtomically(db, userId, eventInputs, 'session', companionStatements);
    return {
      id: sessionId,
      disposition,
      endedAt: finalizedAt,
      eventsAppended: committed.events,
      masteryDeltas: committed.masteryDeltas,
      alreadyFinalized: false,
    };
  } catch (error) {
    // The finalization PK is the expected losing-race failure. Reloading the
    // canonical winner also makes a lost-response retry idempotent. Do not
    // hide unrelated failures when no terminal row committed.
    const refreshed = await requireOwnedSession(db, userId, sessionId);
    const winner = await existingFinalizationResult(db, userId, refreshed, disposition);
    if (winner) return winner;
    throw error;
  }
}

export async function completeSession(db: Db, userId: string, sessionId: string, input: CompleteStudySessionInput) {
  return finalizeSession(db, userId, sessionId, 'completed', input);
}

export async function discardSession(db: Db, userId: string, sessionId: string, input: DiscardStudySessionInput) {
  return finalizeSession(db, userId, sessionId, 'discarded', input);
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
