import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { courses, studySessions, users } from '../src/db/schema';
import { completeSession, createSession, listSessions } from '../src/lib/services/sessions';

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
});
