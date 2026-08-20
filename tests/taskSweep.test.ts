import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import {
  assessmentKcs,
  assessments,
  branches,
  classSessions,
  courses,
  kcs,
  rituals,
  taskCourses,
  tasks,
  users,
} from '../src/db/schema';
import { isoWeekday, localNoon } from '../src/lib/services/classSessions';
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

async function setGenerators(overrides: Record<string, boolean>) {
  await db.update(users).set({ settings: { task_generators: overrides } }).where(eq(users.id, userId));
}

async function allTasks() {
  return db.select().from(tasks).where(eq(tasks.userId, userId));
}

async function tasksOfType(type: string) {
  return (await allTasks()).filter((t) => t.type === type);
}

async function makeKc(kcCourseId: string, mastery: number, name: string, lastEventAt: number | null = null) {
  const branchId = crypto.randomUUID();
  const kcId = crypto.randomUUID();
  await db.insert(branches).values({ id: branchId, courseId: kcCourseId, name: `${name} branch` });
  await db.insert(kcs).values({ id: kcId, branchId, courseId: kcCourseId, name, mastery, lastEventAt });
  return kcId;
}

// Mirrors scripts/seed.ts / taskSweep.ts's private helper of the same name —
// duplicated here only so tests can assert on the dedupe key's exact shape.
function yyyymmdd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

describe('collectAttendClass', () => {
  it('generates one row per class session in the ±7d window, skips archived courses, and pre-completes attended sessions', async () => {
    const now = Date.now();
    const todayNoon = localNoon(now);

    const archivedCourseId = crypto.randomUUID();
    await db.insert(courses).values({
      id: archivedCourseId,
      userId,
      code: 'OLD 101',
      slug: `old-${archivedCourseId}`,
      title: 'Archived Course',
      archived: true,
    });

    const openId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: openId, userId, courseId, date: todayNoon, status: null, source: 'schedule' });

    const attendedId = crypto.randomUUID();
    await db.insert(classSessions).values({
      id: attendedId,
      userId,
      courseId,
      date: todayNoon - 2 * DAY_MS,
      status: 'attended',
      source: 'schedule',
    });

    const outOfWindowId = crypto.randomUUID();
    await db.insert(classSessions).values({
      id: outOfWindowId,
      userId,
      courseId,
      date: todayNoon - 8 * DAY_MS,
      status: null,
      source: 'schedule',
    });

    await db.insert(classSessions).values({
      id: crypto.randomUUID(),
      userId,
      courseId: archivedCourseId,
      date: todayNoon,
      status: null,
      source: 'schedule',
    });

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('attend_class');
    expect(rows.map((r) => r.classSessionId).sort()).toEqual([attendedId, openId].sort());

    const attendedRow = rows.find((r) => r.classSessionId === attendedId)!;
    expect(attendedRow.done).toBe(true);
    expect(attendedRow.completedAt).not.toBeNull();
    expect(attendedRow.dueDate).toBe(todayNoon - 2 * DAY_MS);
    expect(attendedRow.title).toBe('Attend TEST 101');
    expect(attendedRow.dedupeKey).toBe(`attend_class:${attendedId}`);

    const openRow = rows.find((r) => r.classSessionId === openId)!;
    expect(openRow.done).toBe(false);
    expect(openRow.completedAt).toBeNull();

    // Idempotent re-sweep must not duplicate.
    await sweepTasks(db, userId, now);
    expect(await tasksOfType('attend_class')).toHaveLength(2);
  });

  it('generates nothing when the generator is toggled off', async () => {
    const now = Date.now();
    await setGenerators({ attend_class: false });
    await db.insert(classSessions).values({
      id: crypto.randomUUID(),
      userId,
      courseId,
      date: localNoon(now),
      status: null,
      source: 'schedule',
    });

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('attend_class')).toHaveLength(0);
  });
});

describe('collectPrepBeforeClass', () => {
  it('generates a prep task for each meeting day in (today, today+2d], due the day before class', async () => {
    const now = Date.now();
    const todayNoon = localNoon(now);
    const tomorrow = todayNoon + DAY_MS;
    const dayAfter = todayNoon + 2 * DAY_MS;

    await setGenerators({ prep_before_class: true });
    await db.update(courses).set({ meetingDays: JSON.stringify([isoWeekday(tomorrow), isoWeekday(dayAfter)]) }).where(eq(courses.id, courseId));

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('prep_before_class');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dueDate).sort()).toEqual([todayNoon, tomorrow].sort());
    expect(rows.every((r) => r.title === 'Prep for TEST 101')).toBe(true);
    expect(rows.every((r) => r.courseId === courseId)).toBe(true);

    const dedupeKeys = rows.map((r) => r.dedupeKey).sort();
    expect(dedupeKeys).toEqual(
      [`prep_before_class:${courseId}:${yyyymmdd(tomorrow)}`, `prep_before_class:${courseId}:${yyyymmdd(dayAfter)}`].sort(),
    );

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('prep_before_class')).toHaveLength(2);
  });

  it('is off by default (opt-in family) even with matching meeting days', async () => {
    const now = Date.now();
    await db.update(courses).set({ meetingDays: JSON.stringify([1, 2, 3, 4, 5, 6, 7]) }).where(eq(courses.id, courseId));

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('prep_before_class')).toHaveLength(0);
  });
});

describe('collectReviewAfterClass', () => {
  it('generates a review task the day after an attended class session, only within the 3-day lookback', async () => {
    const now = Date.now();
    const todayNoon = localNoon(now);

    const recentId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: recentId, userId, courseId, date: todayNoon - 2 * DAY_MS, status: 'attended', source: 'schedule' });

    await db.insert(classSessions).values({
      id: crypto.randomUUID(),
      userId,
      courseId,
      date: todayNoon - 5 * DAY_MS,
      status: 'attended',
      source: 'schedule',
    });

    await db.insert(classSessions).values({
      id: crypto.randomUUID(),
      userId,
      courseId,
      date: todayNoon - 1 * DAY_MS,
      status: 'missed',
      source: 'schedule',
    });

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('review_after_class');
    expect(rows.map((r) => r.classSessionId)).toEqual([recentId]);
    expect(rows[0].dueDate).toBe(todayNoon - 2 * DAY_MS + DAY_MS);
    expect(rows[0].title).toBe('Review notes: TEST 101');
    expect(rows[0].dedupeKey).toBe(`review_after_class:${recentId}`);

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('review_after_class')).toHaveLength(1);
  });

  it('generates nothing when toggled off', async () => {
    const now = Date.now();
    await setGenerators({ review_after_class: false });
    await db.insert(classSessions).values({
      id: crypto.randomUUID(),
      userId,
      courseId,
      date: localNoon(now),
      status: 'attended',
      source: 'schedule',
    });

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('review_after_class')).toHaveLength(0);
  });
});

describe('collectPracticeKc', () => {
  it('links KCs below 80 mastery to an ungraded official assessment due within 7 days, capped at 5, lowest-mastery-first', async () => {
    const now = Date.now();
    const assessmentId = crypto.randomUUID();
    await db.insert(assessments).values({ id: assessmentId, courseId, title: 'Midterm', type: 'midterm', dueDate: now + 3 * DAY_MS, kind: 'official' });

    const kcMasteries: Record<string, number> = {};
    for (const mastery of [10, 90, 40, 20, 70, 60, 5]) {
      const kcId = await makeKc(courseId, mastery, `KC ${mastery}`);
      kcMasteries[kcId] = mastery;
      await db.insert(assessmentKcs).values({ id: crypto.randomUUID(), assessmentId, kcId });
    }

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('practice_kc');
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.assessmentId === assessmentId)).toBe(true);
    expect(rows.every((r) => r.courseId === courseId)).toBe(true);
    expect(rows.every((r) => r.dueDate === localNoon(now + 3 * DAY_MS) - DAY_MS)).toBe(true);

    // 90 is excluded outright (>=80); 70 is the 6th-lowest and loses the cap.
    const includedMasteries = rows.map((r) => kcMasteries[r.kcId!]).sort((a, b) => a - b);
    expect(includedMasteries).toEqual([5, 10, 20, 40, 60]);

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('practice_kc')).toHaveLength(5);
  });

  it('excludes graded, out-of-window, and practice-kind assessments', async () => {
    const now = Date.now();
    const kcId = await makeKc(courseId, 10, 'Low mastery KC');

    const gradedId = crypto.randomUUID();
    await db.insert(assessments).values({ id: gradedId, courseId, title: 'Graded', type: 'quiz', dueDate: now + 2 * DAY_MS, kind: 'official', gradeReceived: 90, gradeMax: 100 });
    await db.insert(assessmentKcs).values({ id: crypto.randomUUID(), assessmentId: gradedId, kcId });

    const farId = crypto.randomUUID();
    await db.insert(assessments).values({ id: farId, courseId, title: 'Far out', type: 'quiz', dueDate: now + 30 * DAY_MS, kind: 'official' });
    await db.insert(assessmentKcs).values({ id: crypto.randomUUID(), assessmentId: farId, kcId });

    const practiceId = crypto.randomUUID();
    await db.insert(assessments).values({ id: practiceId, courseId, title: 'Practice test', type: 'quiz', dueDate: now + 2 * DAY_MS, kind: 'practice' });
    await db.insert(assessmentKcs).values({ id: crypto.randomUUID(), assessmentId: practiceId, kcId });

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('practice_kc')).toHaveLength(0);
  });

  it('due-date window is exclusive of now and inclusive of now+7d', async () => {
    const now = Date.now();
    const kcId = await makeKc(courseId, 10, 'Edge KC');

    const dueNowId = crypto.randomUUID();
    await db.insert(assessments).values({ id: dueNowId, courseId, title: 'Due right now', type: 'quiz', dueDate: now, kind: 'official' });
    await db.insert(assessmentKcs).values({ id: crypto.randomUUID(), assessmentId: dueNowId, kcId });

    const dueAtBoundId = crypto.randomUUID();
    await db.insert(assessments).values({ id: dueAtBoundId, courseId, title: 'Due at bound', type: 'quiz', dueDate: now + 7 * DAY_MS, kind: 'official' });
    await db.insert(assessmentKcs).values({ id: crypto.randomUUID(), assessmentId: dueAtBoundId, kcId });

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('practice_kc');
    expect(rows.map((r) => r.assessmentId)).toEqual([dueAtBoundId]);
  });

  it('generates nothing when toggled off', async () => {
    const now = Date.now();
    await setGenerators({ practice_kc: false });
    const assessmentId = crypto.randomUUID();
    await db.insert(assessments).values({ id: assessmentId, courseId, title: 'Midterm', type: 'midterm', dueDate: now + 3 * DAY_MS, kind: 'official' });
    const kcId = await makeKc(courseId, 10, 'Low mastery KC');
    await db.insert(assessmentKcs).values({ id: crypto.randomUUID(), assessmentId, kcId });

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('practice_kc')).toHaveLength(0);
  });
});

describe('collectStaleKc', () => {
  it('flags idle KCs (mastery>0, lastEventAt older than 7d), lowest mastery first, capped at 3/sweep and 1/course', async () => {
    const now = Date.now();
    await setGenerators({ stale_kc: true });

    const course2Id = crypto.randomUUID();
    await db.insert(courses).values({ id: course2Id, userId, code: 'TEST 202', slug: `test2-${course2Id}`, title: 'Course 2' });

    const idleOld = now - 10 * DAY_MS;
    const c1a = await makeKc(courseId, 50, 'C1-A idle', idleOld);
    const c1b = await makeKc(courseId, 30, 'C1-B idle', idleOld);
    const c2a = await makeKc(course2Id, 20, 'C2-A idle', idleOld);
    await makeKc(courseId, 0, 'C1-zero idle', idleOld); // excluded: mastery not > 0
    await makeKc(courseId, 70, 'C1-recent', now - 1 * DAY_MS); // excluded: not idle enough

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('stale_kc');
    // C2-A (20) and C1-B (30) win the lowest-mastery-first ordering;
    // C1-A (50) is excluded by the 1-per-course cap since C1-B already
    // claimed course 1's slot.
    expect(rows.map((r) => r.kcId).sort()).toEqual([c1b, c2a].sort());
    expect(rows.every((r) => r.dueDate === null)).toBe(true);
    expect(rows.some((r) => r.kcId === c1a)).toBe(false);

    // Idempotent re-sweep must not duplicate.
    await sweepTasks(db, userId, now);
    expect(await tasksOfType('stale_kc')).toHaveLength(2);
  });

  it('re-keys the dedupe when lastEventAt bumps, so an updated KC mints a fresh task', async () => {
    const now = Date.now();
    await setGenerators({ stale_kc: true });

    const firstIdle = now - 10 * DAY_MS;
    const kcId = await makeKc(courseId, 40, 'Idle KC', firstIdle);

    await sweepTasks(db, userId, now);
    const first = await tasksOfType('stale_kc');
    expect(first).toHaveLength(1);
    expect(first[0].dedupeKey).toBe(`stale_kc:${kcId}:${firstIdle}`);

    // Still stale relative to `now`, but a different lastEventAt — re-keys
    // rather than staying silent forever on the first-ever dedupe key.
    const secondIdle = now - 8 * DAY_MS;
    await db.update(kcs).set({ lastEventAt: secondIdle }).where(eq(kcs.id, kcId));

    await sweepTasks(db, userId, now);
    const second = await tasksOfType('stale_kc');
    expect(second).toHaveLength(2);
    expect(second.map((r) => r.dedupeKey).sort()).toEqual(
      [`stale_kc:${kcId}:${firstIdle}`, `stale_kc:${kcId}:${secondIdle}`].sort(),
    );
  });

  it('stays off by default (opt-in family) even with a qualifying idle KC', async () => {
    const now = Date.now();
    await makeKc(courseId, 40, 'Idle KC', now - 10 * DAY_MS);

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('stale_kc')).toHaveLength(0);
  });
});

describe('collectGradeEntry', () => {
  it('flags ungraded official assessments due in the last 14 days, due 3 days after the original due date', async () => {
    const now = Date.now();
    const assessmentId = crypto.randomUUID();
    const dueDate = now - 5 * DAY_MS;
    await db.insert(assessments).values({ id: assessmentId, courseId, title: 'Quiz 1', type: 'quiz', dueDate, kind: 'official' });

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('grade_entry');
    expect(rows).toHaveLength(1);
    expect(rows[0].assessmentId).toBe(assessmentId);
    expect(rows[0].dueDate).toBe(localNoon(dueDate) + 3 * DAY_MS);
    expect(rows[0].title).toBe('Enter grade: Quiz 1');
    expect(rows[0].dedupeKey).toBe(`grade_entry:${assessmentId}`);

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('grade_entry')).toHaveLength(1);
  });

  it('excludes graded, future, and practice-kind assessments', async () => {
    const now = Date.now();

    const futureId = crypto.randomUUID();
    await db.insert(assessments).values({ id: futureId, courseId, title: 'Future', type: 'quiz', dueDate: now + DAY_MS, kind: 'official' });

    const gradedId = crypto.randomUUID();
    await db.insert(assessments).values({ id: gradedId, courseId, title: 'Graded', type: 'quiz', dueDate: now - DAY_MS, kind: 'official', gradeReceived: 80, gradeMax: 100 });

    const practiceId = crypto.randomUUID();
    await db.insert(assessments).values({ id: practiceId, courseId, title: 'Practice', type: 'quiz', dueDate: now - DAY_MS, kind: 'practice' });

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('grade_entry')).toHaveLength(0);
  });

  it('window edges: due exactly 14 days ago is included, due exactly now is excluded', async () => {
    const now = Date.now();
    const atLowerBoundId = crypto.randomUUID();
    await db.insert(assessments).values({ id: atLowerBoundId, courseId, title: 'Lower bound', type: 'quiz', dueDate: now - 14 * DAY_MS, kind: 'official' });

    const atUpperBoundId = crypto.randomUUID();
    await db.insert(assessments).values({ id: atUpperBoundId, courseId, title: 'Upper bound', type: 'quiz', dueDate: now, kind: 'official' });

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('grade_entry');
    expect(rows.map((r) => r.assessmentId)).toEqual([atLowerBoundId]);
  });

  it('generates nothing when toggled off', async () => {
    const now = Date.now();
    await setGenerators({ grade_entry: false });
    await db.insert(assessments).values({ id: crypto.randomUUID(), courseId, title: 'Quiz', type: 'quiz', dueDate: now - DAY_MS, kind: 'official' });

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('grade_entry')).toHaveLength(0);
  });
});

describe('collectRituals', () => {
  async function makeRitual(overrides: Partial<typeof rituals.$inferInsert> = {}) {
    const id = crypto.randomUUID();
    await db.insert(rituals).values({
      id,
      userId,
      name: 'Test ritual',
      kind: 'recurring',
      active: true,
      ...overrides,
    });
    return id;
  }

  it('daily cadence mints one task for today and each of the trailing 6 days, idempotent on re-sweep', async () => {
    const now = Date.now();
    const todayNoon = localNoon(now);
    const ritualId = await makeRitual({ cadence: 'daily' });

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('ritual');
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.ritualId === ritualId)).toBe(true);
    expect(rows.every((r) => r.title === 'Test ritual')).toBe(true);
    const expectedDueDates = Array.from({ length: 7 }, (_, i) => todayNoon - i * DAY_MS).sort();
    expect(rows.map((r) => r.dueDate).sort()).toEqual(expectedDueDates);
    expect(rows.map((r) => r.dedupeKey).sort()).toEqual(
      expectedDueDates.map((d) => `ritual:${ritualId}:${yyyymmdd(d)}`).sort(),
    );

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('ritual')).toHaveLength(7);
  });

  it('weekly cadence only mints on matching by_weekday days within the trailing window', async () => {
    const now = Date.now();
    const todayNoon = localNoon(now);
    const targetWeekday = isoWeekday(todayNoon);
    await makeRitual({ cadence: 'weekly', byWeekday: JSON.stringify([targetWeekday]) });

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('ritual');
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBe(todayNoon);
  });

  it('after_class cadence keys off attended class sessions for the ritual\'s course, due the day after', async () => {
    const now = Date.now();
    const todayNoon = localNoon(now);
    const ritualId = await makeRitual({ cadence: 'after_class', courseId });

    const attendedId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: attendedId, userId, courseId, date: todayNoon - 2 * DAY_MS, status: 'attended', source: 'schedule' });
    await db.insert(classSessions).values({ id: crypto.randomUUID(), userId, courseId, date: todayNoon - 5 * DAY_MS, status: 'attended', source: 'schedule' });

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('ritual');
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBe(todayNoon - 2 * DAY_MS + DAY_MS);
    expect(rows[0].courseId).toBe(courseId);
    expect(rows[0].dedupeKey).toBe(`ritual:${ritualId}:${yyyymmdd(todayNoon - 2 * DAY_MS)}`);
  });

  it('before_class cadence keys off the course\'s meetingDays within the 2-day lookahead, due the day before', async () => {
    const now = Date.now();
    const todayNoon = localNoon(now);
    const tomorrow = todayNoon + DAY_MS;
    await db.update(courses).set({ meetingDays: JSON.stringify([isoWeekday(tomorrow)]) }).where(eq(courses.id, courseId));
    await makeRitual({ cadence: 'before_class', courseId });

    await sweepTasks(db, userId, now);
    const rows = await tasksOfType('ritual');
    expect(rows).toHaveLength(1);
    expect(rows[0].dueDate).toBe(todayNoon);
  });

  it('a deactivated ritual generates nothing', async () => {
    const now = Date.now();
    await makeRitual({ cadence: 'daily', active: false });

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('ritual')).toHaveLength(0);
  });

  it('a plain session_shape ritual (no recurring cadence) generates nothing', async () => {
    const now = Date.now();
    await makeRitual({ kind: 'session_shape', cadence: null, steps: [{ kind: 'reflect' }] });

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('ritual')).toHaveLength(0);
  });

  it('never resurrects a dismissed ritual occurrence on re-sweep', async () => {
    const now = Date.now();
    const todayNoon = localNoon(now);
    const ritualId = await makeRitual({ cadence: 'daily' });

    await sweepTasks(db, userId, now);
    const todayRow = (await tasksOfType('ritual')).find((r) => r.dueDate === todayNoon)!;
    await db.update(tasks).set({ dismissedAt: now }).where(eq(tasks.id, todayRow.id));

    await sweepTasks(db, userId, now);
    const after = await db.select().from(tasks).where(eq(tasks.dedupeKey, `ritual:${ritualId}:${yyyymmdd(todayNoon)}`));
    expect(after).toHaveLength(1);
    expect(after[0].dismissedAt).not.toBeNull();
  });

  it('is off by default toggle-respecting: generates nothing when task_generators.ritual is false', async () => {
    const now = Date.now();
    await setGenerators({ ritual: false });
    await makeRitual({ cadence: 'daily' });

    await sweepTasks(db, userId, now);
    expect(await tasksOfType('ritual')).toHaveLength(0);
  });
});

describe('generator gating', () => {
  it('does nothing at all when every generator is disabled', async () => {
    const now = Date.now();
    await setGenerators({
      attend_class: false,
      prep_before_class: false,
      review_after_class: false,
      practice_kc: false,
      stale_kc: false,
      grade_entry: false,
    });

    await db.insert(classSessions).values({ id: crypto.randomUUID(), userId, courseId, date: localNoon(now), status: 'attended', source: 'schedule' });
    await db.insert(assessments).values({ id: crypto.randomUUID(), courseId, title: 'Quiz', type: 'quiz', dueDate: now - DAY_MS, kind: 'official' });

    await sweepTasks(db, userId, now);
    expect(await allTasks()).toHaveLength(0);
  });
});

describe('task_courses backfill', () => {
  it('links every system task with a courseId exactly once, even across repeated sweeps', async () => {
    const now = Date.now();
    await db.insert(classSessions).values({ id: crypto.randomUUID(), userId, courseId, date: localNoon(now), status: 'attended', source: 'schedule' });

    await sweepTasks(db, userId, now);
    await sweepTasks(db, userId, now);
    await sweepTasks(db, userId, now);

    const systemTasks = await db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.source, 'system')));
    expect(systemTasks.length).toBeGreaterThan(0);

    for (const task of systemTasks) {
      if (!task.courseId) continue;
      const links = await db.select().from(taskCourses).where(and(eq(taskCourses.taskId, task.id), eq(taskCourses.courseId, task.courseId)));
      expect(links).toHaveLength(1);
    }
  });
});

describe('dismissal', () => {
  it('never resurrects a dismissed system task on re-sweep', async () => {
    const now = Date.now();
    const sessionId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: sessionId, userId, courseId, date: localNoon(now), status: null, source: 'schedule' });

    await sweepTasks(db, userId, now);
    const [row] = await tasksOfType('attend_class');
    expect(row).toBeDefined();

    await db.update(tasks).set({ dismissedAt: now }).where(eq(tasks.id, row.id));

    await sweepTasks(db, userId, now);
    const after = await db.select().from(tasks).where(eq(tasks.dedupeKey, `attend_class:${sessionId}`));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(row.id);
    expect(after[0].dismissedAt).not.toBeNull();
  });
});

describe('retention', () => {
  it('purges dismissed system tasks older than 120 days', async () => {
    const now = Date.now();
    const oldDismissed = now - 130 * DAY_MS;
    const staleTaskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: staleTaskId,
      userId,
      title: 'Old dismissed task',
      type: 'todo',
      source: 'system',
      dedupeKey: 'old-dismissed-1',
      dismissedAt: oldDismissed,
    });

    await sweepTasks(db, userId, now);
    const rows = await db.select().from(tasks).where(eq(tasks.id, staleTaskId));
    expect(rows).toHaveLength(0);
  });
});
