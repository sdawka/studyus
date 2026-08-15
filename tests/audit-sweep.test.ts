// Audit fixes: taskSweep's cross-tenant retention purge, generator "why"
// descriptions, the sweep-once-per-request opt-out param on
// listTasks/getCalendar, and the meeting_days retirement cleanup in
// updateCourse.
import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { classSessions, courses, tasks, users } from '../src/db/schema';
import { getCalendar } from '../src/lib/services/calendar';
import { localNoon } from '../src/lib/services/classSessions';
import { updateCourse } from '../src/lib/services/courses';
import { listTasks } from '../src/lib/services/tasks';
import { sweepTasks } from '../src/lib/services/taskSweep';

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

describe('sweepTasks retention purge — cross-tenant scoping', () => {
  it('never deletes another user’s old dismissed tasks', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });

    const now = Date.now();
    const oldDismissed = now - 130 * DAY_MS;

    const otherTaskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: otherTaskId,
      userId: otherUserId,
      title: 'Other user’s old dismissed task',
      type: 'todo',
      source: 'system',
      dedupeKey: 'other-old-dismissed-1',
      dismissedAt: oldDismissed,
    });

    // Sweeping userId's tasks must not touch otherUserId's rows.
    await sweepTasks(db, userId, now);

    const rows = await db.select().from(tasks).where(eq(tasks.id, otherTaskId));
    expect(rows).toHaveLength(1);
  });

  it('still purges the calling user’s own old dismissed tasks (regression guard)', async () => {
    const now = Date.now();
    const oldDismissed = now - 130 * DAY_MS;
    const staleTaskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: staleTaskId,
      userId,
      title: 'Old dismissed task',
      type: 'todo',
      source: 'system',
      dedupeKey: 'own-old-dismissed-1',
      dismissedAt: oldDismissed,
    });

    await sweepTasks(db, userId, now);
    const rows = await db.select().from(tasks).where(eq(tasks.id, staleTaskId));
    expect(rows).toHaveLength(0);
  });
});

describe('generator descriptions — non-null "why" on the wire', () => {
  it('populates a description for every generator family', async () => {
    const now = Date.now();
    const todayNoon = localNoon(now);

    await db.update(users).set({
      settings: {
        task_generators: {
          attend_class: true,
          prep_before_class: true,
          review_after_class: true,
          practice_kc: true,
          stale_kc: true,
          grade_entry: true,
        },
      },
    }).where(eq(users.id, userId));

    await db.update(courses).set({ meetingDays: JSON.stringify([1, 2, 3, 4, 5, 6, 7]) }).where(eq(courses.id, courseId));
    await db.insert(classSessions).values({ id: crypto.randomUUID(), userId, courseId, date: todayNoon - DAY_MS, status: 'attended', source: 'schedule' });

    await sweepTasks(db, userId, now);
    const rows = await db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.source, 'system')));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.description).not.toBeNull();
      expect(row.description!.length).toBeGreaterThan(0);
    }
  });
});

describe('listTasks / getCalendar — sweep opt-out param', () => {
  it('listTasks({ sweep: false }) does not generate new system tasks', async () => {
    const now = Date.now();
    await db.insert(classSessions).values({ id: crypto.randomUUID(), userId, courseId, date: localNoon(now), status: null, source: 'schedule' });

    const list = await listTasks(db, userId, { sweep: false });
    expect(list.filter((t) => t.type === 'attend_class')).toHaveLength(0);

    // Default (sweep: true, or omitted) still generates as before.
    const listWithSweep = await listTasks(db, userId);
    expect(listWithSweep.filter((t) => t.type === 'attend_class')).toHaveLength(1);
  });

  it('getCalendar({ sweep: false }) does not generate new system tasks', async () => {
    const now = Date.now();
    await db.insert(classSessions).values({ id: crypto.randomUUID(), userId, courseId, date: localNoon(now), status: null, source: 'schedule' });

    await getCalendar(db, userId, now - DAY_MS, now + DAY_MS, undefined, { sweep: false });
    const rows = await db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.type, 'attend_class')));
    expect(rows).toHaveLength(0);
  });
});

describe('updateCourse — meeting_days retirement', () => {
  it('retires future unmarked schedule-sourced sessions (and their tasks) for a dropped weekday, leaves past/marked ones alone', async () => {
    const now = Date.now();
    const todayNoon = localNoon(now);
    await updateCourse(db, userId, courseId, { meeting_days: [1, 3] }); // Mon, Wed

    // Find the next couple of future Mon/Wed dates for the fixtures below.
    function nextWeekday(from: number, weekday: number): number {
      let day = from;
      for (let i = 0; i < 14; i++) {
        const dow = new Date(day).getUTCDay();
        const iso = dow === 0 ? 7 : dow;
        if (iso === weekday) return day;
        day += DAY_MS;
      }
      throw new Error('not found');
    }

    const futureMon = nextWeekday(todayNoon + DAY_MS, 1);
    const futureWed = nextWeekday(todayNoon + DAY_MS, 3);
    const pastMon = nextWeekday(todayNoon - 30 * DAY_MS, 1);

    const futureMonId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: futureMonId, userId, courseId, date: futureMon, status: null, source: 'schedule' });
    const futureWedMarkedId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: futureWedMarkedId, userId, courseId, date: futureWed, status: 'attended', source: 'schedule' });
    const pastMonId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: pastMonId, userId, courseId, date: pastMon, status: null, source: 'schedule' });

    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: 'Attend TEST 101',
      type: 'attend_class',
      courseId,
      classSessionId: futureMonId,
      source: 'system',
      dedupeKey: `attend_class:${futureMonId}`,
      dueDate: futureMon,
    });

    // Drop Monday from the schedule — Tue/Thu now.
    await updateCourse(db, userId, courseId, { meeting_days: [2, 4] });

    const remaining = await db.select().from(classSessions).where(eq(classSessions.courseId, courseId));
    const remainingIds = remaining.map((r) => r.id);
    expect(remainingIds).not.toContain(futureMonId); // future, unmarked, dropped weekday — gone
    expect(remainingIds).toContain(futureWedMarkedId); // marked — survives even though Wed was also dropped
    expect(remainingIds).toContain(pastMonId); // past — survives

    // The linked attend_class task cascade-deletes with its class_sessions row.
    const taskRows = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(taskRows).toHaveLength(0);
  });

  it('does nothing when meeting_days is not part of the PATCH', async () => {
    const now = Date.now();
    await updateCourse(db, userId, courseId, { meeting_days: [1, 3] });
    const sessionId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: sessionId, userId, courseId, date: localNoon(now) + 10 * DAY_MS, status: null, source: 'schedule' });

    await updateCourse(db, userId, courseId, { title: 'Renamed' });

    const rows = await db.select().from(classSessions).where(eq(classSessions.id, sessionId));
    expect(rows).toHaveLength(1);
  });
});
