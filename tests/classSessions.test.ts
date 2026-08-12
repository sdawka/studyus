import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { classSessions, courses, users } from '../src/db/schema';
import { updateCourseSchema } from '../src/lib/schemas/courses';
import { toApi } from '../src/lib/serialize';
import { createEvent } from '../src/lib/services/events';
import { updateCourse } from '../src/lib/services/courses';
import { NotFoundError, ConflictError } from '../src/lib/services/util';
import {
  createManualClassSession,
  listClassSessions,
  toLocalNoon,
  updateClassSessionStatus,
} from '../src/lib/services/classSessions';

const db = getDb(env.DB);

let userId: string;
let courseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
});

function isoWeekdayOf(noonMs: number): number {
  const dow = new Date(noonMs).getDay();
  return dow === 0 ? 7 : dow;
}

describe('sweep (via listClassSessions)', () => {
  it('generates one row per matching weekday in the 70-day window, normalized to local noon, never in the future, and is idempotent', async () => {
    const meetingDays = [1, 3, 5]; // Mon, Wed, Fri
    await db.update(courses).set({ meetingDays: JSON.stringify(meetingDays) }).where(eq(courses.id, courseId));

    const first = await listClassSessions(db, userId, courseId, {});
    expect(first.length).toBeGreaterThan(0);

    const todayNoon = toLocalNoon(new Date().toISOString());
    for (const row of first) {
      expect(meetingDays).toContain(isoWeekdayOf(row.date));
      expect(new Date(row.date).getHours()).toBe(12);
      expect(new Date(row.date).getMinutes()).toBe(0);
      expect(row.date).toBeLessThanOrEqual(todayNoon);
      expect(row.source).toBe('schedule');
      expect(row.status).toBeNull();
    }

    // Re-running must not create duplicates (ON CONFLICT(course_id, date) DO NOTHING).
    const second = await listClassSessions(db, userId, courseId, {});
    expect(second.length).toBe(first.length);
    expect(new Set(second.map((r) => r.id))).toEqual(new Set(first.map((r) => r.id)));
  });

  it('does not generate anything for a course with no meeting_days', async () => {
    const rows = await listClassSessions(db, userId, courseId, {});
    expect(rows).toHaveLength(0);
  });
});

describe('backfill from lecture events', () => {
  it('seeds a generated session status from a same-day lecture event, attended winning over missed', async () => {
    const todayNoon = toLocalNoon(new Date().toISOString());
    const todayIso = isoWeekdayOf(todayNoon);
    await db.update(courses).set({ meetingDays: JSON.stringify([todayIso]) }).where(eq(courses.id, courseId));

    // Same local day as todayNoon, a few hours earlier — still within the day.
    const eventTs = new Date(todayNoon - 2 * 60 * 60 * 1000).toISOString();
    await createEvent(db, userId, { type: 'lecture_missed', course_id: courseId, ts: eventTs });
    await createEvent(db, userId, { type: 'lecture_attended', course_id: courseId, ts: eventTs });

    const rows = await listClassSessions(db, userId, courseId, {});
    const today = rows.find((r) => r.date === todayNoon);
    expect(today).toBeDefined();
    expect(today!.status).toBe('attended');
  });

  it('backfills missed when only a lecture_missed event exists for the day', async () => {
    const todayNoon = toLocalNoon(new Date().toISOString());
    const todayIso = isoWeekdayOf(todayNoon);
    await db.update(courses).set({ meetingDays: JSON.stringify([todayIso]) }).where(eq(courses.id, courseId));

    const eventTs = new Date(todayNoon - 3 * 60 * 60 * 1000).toISOString();
    await createEvent(db, userId, { type: 'lecture_missed', course_id: courseId, ts: eventTs });

    const rows = await listClassSessions(db, userId, courseId, {});
    const today = rows.find((r) => r.date === todayNoon);
    expect(today?.status).toBe('missed');
  });
});

describe('updateClassSessionStatus (PATCH)', () => {
  it('round-trips status through attended, missed, and back to null', async () => {
    const sessionId = crypto.randomUUID();
    await db.insert(classSessions).values({
      id: sessionId,
      userId,
      courseId,
      date: toLocalNoon(new Date().toISOString()),
      status: null,
      source: 'manual',
    });

    const attended = await updateClassSessionStatus(db, userId, sessionId, { status: 'attended' });
    expect(attended.status).toBe('attended');

    const missed = await updateClassSessionStatus(db, userId, sessionId, { status: 'missed' });
    expect(missed.status).toBe('missed');

    const cleared = await updateClassSessionStatus(db, userId, sessionId, { status: null });
    expect(cleared.status).toBeNull();
  });

  it('404s when the class session belongs to another user', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });

    const sessionId = crypto.randomUUID();
    await db.insert(classSessions).values({
      id: sessionId,
      userId,
      courseId,
      date: toLocalNoon(new Date().toISOString()),
      status: null,
      source: 'manual',
    });

    await expect(updateClassSessionStatus(db, otherUserId, sessionId, { status: 'attended' })).rejects.toThrow(NotFoundError);
  });
});

describe('createManualClassSession (POST)', () => {
  it('creates a manual, unmarked session and rejects a duplicate on the same course + date', async () => {
    const dateIso = new Date().toISOString();
    const created = await createManualClassSession(db, userId, courseId, { date: dateIso });
    expect(created.source).toBe('manual');
    expect(created.status).toBeNull();
    expect(created.date).toBe(toLocalNoon(dateIso));

    await expect(createManualClassSession(db, userId, courseId, { date: dateIso })).rejects.toThrow(ConflictError);
  });

  it('404s for a cross-user course id', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });

    await expect(
      createManualClassSession(db, otherUserId, courseId, { date: new Date().toISOString() }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('wire shape (toApi)', () => {
  it('serializes date and created_at as ISO strings, not raw epoch-ms, matching the documented contract', async () => {
    const rows = await createManualClassSession(db, userId, courseId, { date: new Date().toISOString() }).then((r) => [r]);
    const wire = toApi(rows)[0] as Record<string, unknown>;

    expect(typeof wire.date).toBe('string');
    expect(() => new Date(wire.date as string).toISOString()).not.toThrow();
    expect(wire.date).toBe(new Date(rows[0].date).toISOString());

    expect(typeof wire.created_at).toBe('string');
    expect(wire.created_at).toBe(new Date(rows[0].createdAt).toISOString());
  });
});

describe('listClassSessions ownership', () => {
  it('404s for a cross-user course id', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });

    await expect(listClassSessions(db, otherUserId, courseId, {})).rejects.toThrow(NotFoundError);
  });
});

describe('courses.meeting_days', () => {
  it('rejects out-of-range weekday values at the schema level', () => {
    expect(() => updateCourseSchema.parse({ meeting_days: [0] })).toThrow();
    expect(() => updateCourseSchema.parse({ meeting_days: [8] })).toThrow();
  });

  it('dedupes and sorts on PATCH /courses/:id, and is included (parsed) in the response', async () => {
    const updated = await updateCourse(db, userId, courseId, { meeting_days: [5, 1, 3, 1] });
    expect(updated.meetingDays).toEqual([1, 3, 5]);
  });

  it('clears meeting_days when set to null', async () => {
    await updateCourse(db, userId, courseId, { meeting_days: [1, 3] });
    const cleared = await updateCourse(db, userId, courseId, { meeting_days: null });
    expect(cleared.meetingDays).toBeNull();
  });
});
