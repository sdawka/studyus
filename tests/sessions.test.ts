import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, calendarConnections, calendarOutbox, courses, events, kcs, studySessions, users } from '../src/db/schema';
import { completeSession, createSession, deleteSession, listSessions, updateSession } from '../src/lib/services/sessions';
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
    const branchId = crypto.randomUUID();
    const kcId = crypto.randomUUID();
    await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
    await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'KC' });

    const session = await createSession(db, userId, { intended_event_type: 'practice_done', course_id: courseId });
    await completeSession(db, userId, session.id, { kc_ids_touched: [kcId] });

    const appended = await db.select().from(events).where(eq(events.userId, userId));
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ type: 'practice_done', kcId, source: 'session' });
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
