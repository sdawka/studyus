import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import {
  branches,
  calendarConnections,
  calendarOutbox,
  courses,
  events,
  kcs,
  sessionKcs,
  studySessionFinalizations,
  studySessions,
  users,
} from '../src/db/schema';
import { completeSession, createSession, deleteSession, discardSession, listSessions, updateSession } from '../src/lib/services/sessions';
import { ConflictError, NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);

const DAY_MS = 24 * 60 * 60 * 1000;

let userId: string;
let courseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
});

async function createKc(targetCourseId = courseId) {
  const branchId = crypto.randomUUID();
  const kcId = crypto.randomUUID();
  await db.insert(branches).values({ id: branchId, courseId: targetCourseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId: targetCourseId, name: 'KC' });
  return kcId;
}

describe('sessions.createSession', () => {
  it('defaults started_at to now and leaves scheduled_at null when no scheduled_at is given', async () => {
    const before = Date.now();
    const session = await createSession(db, userId, { intended_event_type: 'practice_done' });
    expect(session.scheduledAt).toBeNull();
    expect(session.startedAt).toBeGreaterThanOrEqual(before);
  });

  it('stamps started_at with scheduled_at for a planned session, keeping the NOT NULL column consistent', async () => {
    const scheduledAtIso = new Date(Date.now() + 2 * DAY_MS).toISOString();
    const session = await createSession(db, userId, { intended_event_type: 'practice_done', course_id: courseId, scheduled_at: scheduledAtIso });
    expect(session.scheduledAt).toBe(Date.parse(scheduledAtIso));
    expect(session.startedAt).toBe(session.scheduledAt);
    expect(session.endedAt).toBeNull();
  });

  it('enqueues scheduled sessions for every active controlled calendar connection', async () => {
    await db.insert(calendarConnections).values({
      id: crypto.randomUUID(),
      userId,
      provider: 'google',
      externalAccountId: `google-${userId}`,
      syncMode: 'controlled',
    });
    await db.insert(calendarConnections).values({
      id: crypto.randomUUID(),
      userId,
      provider: 'microsoft',
      externalAccountId: `microsoft-${userId}`,
      syncMode: 'read',
    });

    const session = await createSession(db, userId, {
      intended_event_type: 'practice_done',
      scheduled_at: new Date(Date.now() + DAY_MS).toISOString(),
      planned_minutes: 45,
    });

    const operations = (await db.select().from(calendarOutbox)).filter((row) => row.entityId === session.id);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ action: 'upsert', entityType: 'study_session', status: 'pending' });
  });

  it('validates and deduplicates KC links before atomically creating the session', async () => {
    const kcId = await createKc();
    const session = await createSession(db, userId, {
      intended_event_type: 'practice_done',
      course_id: courseId,
      kc_ids: [kcId, kcId],
    });
    const links = await db.select().from(sessionKcs).where(eq(sessionKcs.studySessionId, session.id));
    expect(links.map((link) => link.kcId)).toEqual([kcId]);
  });

  it('rejects a same-user KC from another course without creating a session', async () => {
    const otherCourseId = crypto.randomUUID();
    await db.insert(courses).values({ id: otherCourseId, userId, code: 'OTHER', slug: `other-${otherCourseId}`, title: 'Other' });
    const otherKcId = await createKc(otherCourseId);

    await expect(createSession(db, userId, {
      intended_event_type: 'practice_done',
      course_id: courseId,
      kc_ids: [otherKcId],
    })).rejects.toThrow(NotFoundError);
    expect(await db.select().from(studySessions).where(eq(studySessions.userId, userId))).toHaveLength(0);
  });
});

describe('sessions.listSessions', () => {
  it('windows on COALESCE(scheduled_at, started_at)', async () => {
    const now = Date.now();
    const inWindow = await createSession(db, userId, {
      intended_event_type: 'practice_done',
      scheduled_at: new Date(now + 2 * DAY_MS).toISOString(),
    });
    const outOfWindow = await createSession(db, userId, {
      intended_event_type: 'practice_done',
      scheduled_at: new Date(now + 20 * DAY_MS).toISOString(),
    });

    const rows = await listSessions(db, userId, {
      from: new Date(now).toISOString(),
      to: new Date(now + 7 * DAY_MS).toISOString(),
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(inWindow.id);
    expect(ids).not.toContain(outOfWindow.id);
  });

  it('projects the persisted terminal disposition additively', async () => {
    const completed = await createSession(db, userId, { intended_event_type: 'practice_done' });
    const discarded = await createSession(db, userId, { intended_event_type: 'practice_done' });
    await completeSession(db, userId, completed.id, { kc_outcomes: [] });
    await discardSession(db, userId, discarded.id, {});

    const rows = await listSessions(db, userId, {});
    expect(rows.find((row) => row.id === completed.id)?.disposition).toBe('completed');
    expect(rows.find((row) => row.id === discarded.id)?.disposition).toBe('discarded');
  });
});

describe('sessions.completeSession', () => {
  it('accepts an optional scheduled_at to reschedule a still-planned session', async () => {
    const session = await createSession(db, userId, {
      intended_event_type: 'practice_done',
      scheduled_at: new Date(Date.now() + DAY_MS).toISOString(),
    });
    const rescheduledIso = new Date(Date.now() + 4 * DAY_MS).toISOString();
    await completeSession(db, userId, session.id, { scheduled_at: rescheduledIso });

    const rows = await db.select().from(studySessions).where(eq(studySessions.id, session.id)).limit(1);
    expect(rows[0].scheduledAt).toBe(Date.parse(rescheduledIso));
  });

  it("appends completion events with source 'session', not user-editable 'manual'", async () => {
    const kcId = await createKc();

    const session = await createSession(db, userId, { intended_event_type: 'practice_done', course_id: courseId });
    await completeSession(db, userId, session.id, { kc_ids_touched: [kcId] });

    const appended = await db.select().from(events).where(eq(events.userId, userId));
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ type: 'practice_done', kcId, source: 'session', sessionId: session.id });
    expect(appended[0].payload).toEqual({ session_id: session.id });
  });

  it('carries a canonical rating on an assessment-capable intended event', async () => {
    const kcId = await createKc();
    const session = await createSession(db, userId, { intended_event_type: 'practice_done', course_id: courseId });

    const result = await completeSession(db, userId, session.id, { kc_outcomes: [{ kc_id: kcId, self_rating: 5 }] });

    expect(result.eventsAppended).toHaveLength(1);
    expect(result.eventsAppended[0]).toMatchObject({ type: 'practice_done', sessionId: session.id, payload: { session_id: session.id, self_rating: 5 } });
    expect(result.masteryDeltas).toHaveLength(1);
  });

  it('atomically adds a self-assessment when an instructional-only event is rated', async () => {
    const kcId = await createKc();
    const session = await createSession(db, userId, { intended_event_type: 'reading_done', course_id: courseId });

    const result = await completeSession(db, userId, session.id, { kc_outcomes: [{ kc_id: kcId, self_rating: 2 }] });

    expect(result.eventsAppended.map((event) => event.type)).toEqual(['reading_done', 'self_assessment']);
    expect(result.eventsAppended[1].payload).toEqual({ session_id: session.id, self_rating: 2 });
    expect(result.masteryDeltas).toHaveLength(1);
  });

  it('treats an explicit empty legacy list as zero events instead of falling back to stored links', async () => {
    const kcId = await createKc();
    const session = await createSession(db, userId, {
      intended_event_type: 'practice_done',
      course_id: courseId,
      kc_ids: [kcId],
    });

    const result = await completeSession(db, userId, session.id, { kc_ids_touched: [] });
    expect(result.eventsAppended).toHaveLength(0);
    expect(await db.select().from(events).where(eq(events.sessionId, session.id))).toHaveLength(0);
  });

  it('falls back to stored links only when both KC fields are omitted', async () => {
    const kcId = await createKc();
    const session = await createSession(db, userId, {
      intended_event_type: 'practice_done',
      course_id: courseId,
      kc_ids: [kcId],
    });

    const result = await completeSession(db, userId, session.id, {});
    expect(result.eventsAppended).toHaveLength(1);
    expect(result.eventsAppended[0].kcId).toBe(kcId);
  });

  it('links KCs first selected at completion and derives course lineage for a general session', async () => {
    const kcId = await createKc();
    const session = await createSession(db, userId, { intended_event_type: 'practice_done' });
    const result = await completeSession(db, userId, session.id, { kc_outcomes: [{ kc_id: kcId }] });

    expect(result.eventsAppended[0]).toMatchObject({ kcId, courseId, sessionId: session.id });
    expect(await db.select().from(sessionKcs).where(eq(sessionKcs.studySessionId, session.id))).toHaveLength(1);
  });

  it('returns the canonical result on completion retries without duplicating evidence', async () => {
    const kcId = await createKc();
    const session = await createSession(db, userId, { intended_event_type: 'practice_done', course_id: courseId });
    const first = await completeSession(db, userId, session.id, { kc_outcomes: [{ kc_id: kcId, self_rating: 4 }] });
    const retry = await completeSession(db, userId, session.id, { kc_outcomes: [{ kc_id: kcId, self_rating: 1 }] });

    expect(first.alreadyFinalized).toBe(false);
    expect(retry.alreadyFinalized).toBe(true);
    expect(retry.masteryDeltas).toEqual([]);
    expect(retry.eventsAppended).toHaveLength(1);
    expect(retry.eventsAppended[0].payload).toEqual({ session_id: session.id, self_rating: 4 });
    expect(await db.select().from(events).where(eq(events.sessionId, session.id))).toHaveLength(1);
  });

  it('converges concurrent completion attempts on one ledger and event set', async () => {
    const kcId = await createKc();
    const session = await createSession(db, userId, { intended_event_type: 'practice_done', course_id: courseId });
    const results = await Promise.all([
      completeSession(db, userId, session.id, { kc_outcomes: [{ kc_id: kcId, self_rating: 3 }] }),
      completeSession(db, userId, session.id, { kc_outcomes: [{ kc_id: kcId, self_rating: 3 }] }),
    ]);

    expect(results.filter((result) => !result.alreadyFinalized)).toHaveLength(1);
    expect(await db.select().from(events).where(eq(events.sessionId, session.id))).toHaveLength(1);
    expect(await db.select().from(studySessionFinalizations).where(eq(studySessionFinalizations.studySessionId, session.id))).toHaveLength(1);
  });

  it('rejects a wrong-course KC before any finalization state is written', async () => {
    const otherCourseId = crypto.randomUUID();
    await db.insert(courses).values({ id: otherCourseId, userId, code: 'OTHER', slug: `other-${otherCourseId}`, title: 'Other' });
    const otherKcId = await createKc(otherCourseId);
    const session = await createSession(db, userId, { intended_event_type: 'practice_done', course_id: courseId });

    await expect(completeSession(db, userId, session.id, { kc_outcomes: [{ kc_id: otherKcId }] })).rejects.toThrow(NotFoundError);
    expect((await db.select().from(studySessions).where(eq(studySessions.id, session.id)))[0].endedAt).toBeNull();
    expect(await db.select().from(studySessionFinalizations).where(eq(studySessionFinalizations.studySessionId, session.id))).toHaveLength(0);
  });

  it('rejects the quick-quiz sentinel terminal path', async () => {
    const id = crypto.randomUUID();
    await db.insert(studySessions).values({ id, userId, intendedEventType: 'quick_quiz', startedAt: Date.now() });
    await expect(completeSession(db, userId, id, { kc_outcomes: [] })).rejects.toThrow(ConflictError);
  });
});

describe('sessions.discardSession', () => {
  it('finalizes a KC-linked session without appending evidence or changing mastery', async () => {
    const kcId = await createKc();
    const session = await createSession(db, userId, {
      intended_event_type: 'practice_done',
      course_id: courseId,
      kc_ids: [kcId],
    });

    const result = await discardSession(db, userId, session.id, {});
    expect(result).toMatchObject({ disposition: 'discarded', alreadyFinalized: false, eventsAppended: [], masteryDeltas: [] });
    expect(await db.select().from(events).where(eq(events.sessionId, session.id))).toHaveLength(0);
    expect((await db.select().from(kcs).where(eq(kcs.id, kcId)))[0].mastery).toBe(0);
  });

  it('makes same-terminal retries idempotent and rejects the opposite terminal', async () => {
    const session = await createSession(db, userId, { intended_event_type: 'practice_done' });
    await discardSession(db, userId, session.id, {});
    expect((await discardSession(db, userId, session.id, {})).alreadyFinalized).toBe(true);
    await expect(completeSession(db, userId, session.id, { kc_outcomes: [] })).rejects.toThrow(ConflictError);
  });
});

describe('sessions.updateSession (v1.6 — PATCH /sessions/:id)', () => {
  it('reschedules scheduled_at and planned_minutes on a still-planned session', async () => {
    await db.insert(calendarConnections).values({
      id: crypto.randomUUID(),
      userId,
      provider: 'google',
      externalAccountId: `google-${userId}`,
      syncMode: 'controlled',
    });
    const session = await createSession(db, userId, {
      intended_event_type: 'practice_done',
      scheduled_at: new Date(Date.now() + DAY_MS).toISOString(),
      planned_minutes: 45,
    });
    const rescheduledIso = new Date(Date.now() + 3 * DAY_MS).toISOString();

    const updated = await updateSession(db, userId, session.id, { scheduled_at: rescheduledIso, planned_minutes: 90 });
    expect(updated.scheduledAt).toBe(Date.parse(rescheduledIso));
    expect(updated.plannedMinutes).toBe(90);
    const operations = (await db.select().from(calendarOutbox)).filter((row) => row.entityId === session.id);
    expect(operations.at(-1)).toMatchObject({ action: 'upsert', entityType: 'study_session' });
  });

  it('rejects rescheduling a completed session with ConflictError', async () => {
    const session = await createSession(db, userId, { intended_event_type: 'practice_done' });
    await completeSession(db, userId, session.id, {});

    await expect(
      updateSession(db, userId, session.id, { scheduled_at: new Date(Date.now() + DAY_MS).toISOString() }),
    ).rejects.toThrow(ConflictError);
  });

  it('404s for a cross-user session id', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    const session = await createSession(db, userId, { intended_event_type: 'practice_done' });

    await expect(updateSession(db, otherUserId, session.id, { planned_minutes: 30 })).rejects.toThrow(NotFoundError);
  });
});

describe('sessions.deleteSession (v1.6 — DELETE /sessions/:id)', () => {
  it('hard-deletes an owned session', async () => {
    await db.insert(calendarConnections).values({
      id: crypto.randomUUID(),
      userId,
      provider: 'google',
      externalAccountId: `google-${userId}`,
      syncMode: 'controlled',
    });
    const session = await createSession(db, userId, { intended_event_type: 'practice_done' });

    await deleteSession(db, userId, session.id);

    const rows = await db.select().from(studySessions).where(eq(studySessions.id, session.id));
    expect(rows).toHaveLength(0);
    const operations = (await db.select().from(calendarOutbox)).filter((row) => row.entityId === session.id);
    expect(operations.at(-1)).toMatchObject({ action: 'delete', entityType: 'study_session' });
  });

  it('404s for a cross-user session id, leaving the row untouched', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    const session = await createSession(db, userId, { intended_event_type: 'practice_done' });

    await expect(deleteSession(db, otherUserId, session.id)).rejects.toThrow(NotFoundError);

    const rows = await db.select().from(studySessions).where(eq(studySessions.id, session.id));
    expect(rows).toHaveLength(1);
  });
});
