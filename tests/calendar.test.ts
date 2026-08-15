import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { assessments, branches, classSessions, courses, kcs, studySessions, taskCourses, tasks, users } from '../src/db/schema';
import { getCalendar } from '../src/lib/services/calendar';
import { createEvent } from '../src/lib/services/events';
import { toLocalNoon } from '../src/lib/services/classSessions';

const db = getDb(env.DB);

const DAY_MS = 24 * 60 * 60 * 1000;

let userId: string;
let courseId: string;
let courseSlug: string;
let otherCourseId: string;
let branchId: string;
let kcId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  otherCourseId = crypto.randomUUID();
  branchId = crypto.randomUUID();
  kcId = crypto.randomUUID();
  courseSlug = `test-${courseId}`;

  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: courseSlug, title: 'Test Course' });
  await db.insert(courses).values({ id: otherCourseId, userId, code: 'OTHER 101', slug: `other-${otherCourseId}`, title: 'Other Course' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Test KC' });
});

describe('getCalendar', () => {
  it('returns assessment_due items with end_date/all_day/href', async () => {
    const dueDate = Date.now() + 3 * DAY_MS;
    const assessmentId = crypto.randomUUID();
    await db.insert(assessments).values({ id: assessmentId, courseId, title: 'Midterm', type: 'midterm', dueDate, weightPct: 20 });

    const items = await getCalendar(db, userId, Date.now(), Date.now() + 7 * DAY_MS);
    const item = items.find((i) => i.id === assessmentId);
    expect(item).toBeDefined();
    expect(item!.type).toBe('assessment_due');
    expect(item!.end_date).toBeNull();
    expect(item!.all_day).toBe(true);
    expect(item!.href).toBe(`/courses/${courseSlug}#assessments`);
    expect(item!.course_id).toBe(courseId);
  });

  it('returns task_due items and resolves multiple linked course_ids without an N+1 query per task', async () => {
    const dueDate = Date.now() + 2 * DAY_MS;
    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({ id: taskId, userId, title: 'Multi-course task', dueDate });
    await db.insert(taskCourses).values([
      { id: crypto.randomUUID(), taskId, courseId },
      { id: crypto.randomUUID(), taskId, courseId: otherCourseId },
    ]);

    const items = await getCalendar(db, userId, Date.now(), Date.now() + 7 * DAY_MS);
    const item = items.find((i) => i.id === taskId);
    expect(item).toBeDefined();
    expect(item!.type).toBe('task_due');
    expect(item!.end_date).toBeNull();
    expect(item!.all_day).toBe(true);
    expect(item!.href).toBe('/tasks');
    expect(item!.details.course_ids).toEqual(expect.arrayContaining([courseId, otherCourseId]));
  });

  it('excludes dismissed tasks from task_due items', async () => {
    const dueDate = Date.now() + DAY_MS;
    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({ id: taskId, userId, title: 'Dismissed task', dueDate, dismissedAt: Date.now() });

    const items = await getCalendar(db, userId, Date.now(), Date.now() + 7 * DAY_MS);
    expect(items.map((i) => i.id)).not.toContain(taskId);
  });

  it('shapes task_due details with task_type/parent_task_id/class_session_id/completed_at for a system (attend_class) task', async () => {
    const sessionDate = Date.now() + DAY_MS;
    const classSessionId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: classSessionId, userId, courseId, date: sessionDate, status: 'attended' });

    const completedAt = Date.now();
    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: 'Attend TEST 101',
      type: 'attend_class',
      dueDate: sessionDate,
      done: true,
      completedAt,
      classSessionId,
      source: 'system',
      dedupeKey: `attend_class:${classSessionId}`,
    });

    const items = await getCalendar(db, userId, Date.now(), Date.now() + 7 * DAY_MS);
    const item = items.find((i) => i.id === taskId);
    expect(item).toBeDefined();
    expect(item!.type).toBe('task_due');
    expect(item!.details).toMatchObject({
      task_type: 'attend_class',
      parent_task_id: null,
      class_session_id: classSessionId,
      completed_at: new Date(completedAt).toISOString(),
    });
  });

  it('returns a completed study_session item with end_date from ended_at', async () => {
    const startedAt = Date.now() - 2 * DAY_MS;
    const endedAt = startedAt + 45 * 60_000;
    const sessionId = crypto.randomUUID();
    await db.insert(studySessions).values({
      id: sessionId,
      userId,
      courseId,
      intendedEventType: 'practice_done',
      plannedMinutes: 60,
      startedAt,
      endedAt,
    });

    const items = await getCalendar(db, userId, Date.now() - 7 * DAY_MS, Date.now() + 7 * DAY_MS);
    const item = items.find((i) => i.id === sessionId);
    expect(item).toBeDefined();
    expect(item!.type).toBe('study_session');
    expect(item!.all_day).toBe(false);
    expect(item!.date).toBe(new Date(startedAt).toISOString());
    expect(item!.end_date).toBe(new Date(endedAt).toISOString());
    expect(item!.href).toBe('/planner');
    expect(item!.details).toMatchObject({ completed: true, scheduled_at: null });
  });

  it('windows a scheduled (not-yet-started) study_session on scheduled_at and derives end_date from planned_minutes', async () => {
    const scheduledAt = Date.now() + 2 * DAY_MS;
    const sessionId = crypto.randomUUID();
    await db.insert(studySessions).values({
      id: sessionId,
      userId,
      courseId,
      intendedEventType: 'practice_done',
      plannedMinutes: 90,
      startedAt: scheduledAt, // NOT NULL column mirrors scheduled_at until the session actually starts
      scheduledAt,
    });

    const items = await getCalendar(db, userId, Date.now(), Date.now() + 7 * DAY_MS);
    const item = items.find((i) => i.id === sessionId);
    expect(item).toBeDefined();
    expect(item!.date).toBe(new Date(scheduledAt).toISOString());
    expect(item!.end_date).toBe(new Date(scheduledAt + 90 * 60_000).toISOString());
    expect(item!.details.completed).toBe(false);
  });

  it('returns an event_logged item with a humanized title, kc suffix, and concepts href', async () => {
    const { event } = await createEvent(db, userId, { type: 'lecture_attended', kc_id: kcId, course_id: courseId });

    const items = await getCalendar(db, userId, Date.now() - DAY_MS, Date.now() + DAY_MS);
    const item = items.find((i) => i.id === event.id);
    expect(item).toBeDefined();
    expect(item!.type).toBe('event_logged');
    expect(item!.title).toBe('Lecture attended · Test KC');
    expect(item!.all_day).toBe(false);
    expect(item!.end_date).toBeNull();
    expect(item!.href).toBe(`/courses/${courseSlug}/concepts`);
    expect(item!.details).toMatchObject({ event_type: 'lecture_attended', kc_id: kcId, is_instructional: true, is_assessment: false });
  });

  it('routes a course-less/KC-less event to /planner with no course suffix in the title', async () => {
    const { event } = await createEvent(db, userId, { type: 'reading_done' });

    const items = await getCalendar(db, userId, Date.now() - DAY_MS, Date.now() + DAY_MS);
    const item = items.find((i) => i.id === event.id);
    expect(item).toBeDefined();
    expect(item!.title).toBe('Reading done');
    expect(item!.href).toBe('/planner');
  });

  it('scopes all four item types to courseId when provided', async () => {
    const dueDate = Date.now() + DAY_MS;
    const otherAssessmentId = crypto.randomUUID();
    await db.insert(assessments).values({ id: otherAssessmentId, courseId: otherCourseId, title: 'Other Midterm', type: 'midterm', dueDate });
    const myAssessmentId = crypto.randomUUID();
    await db.insert(assessments).values({ id: myAssessmentId, courseId, title: 'My Midterm', type: 'midterm', dueDate });

    const items = await getCalendar(db, userId, Date.now(), Date.now() + 7 * DAY_MS, courseId);
    expect(items.map((i) => i.id)).toContain(myAssessmentId);
    expect(items.map((i) => i.id)).not.toContain(otherAssessmentId);
  });

  it('emits a class_session item for a timed class session, and suppresses its linked attend_class task_due item', async () => {
    // `date` is stored at local NOON (see classSessions.ts::localNoon);
    // start_min/end_min are minutes since MIDNIGHT — the actual instant is
    // midnight (date - 12h) + start_min, not date + start_min (12h late).
    // Anchoring sessionDate to a real noon value here (rather than an
    // arbitrary Date.now()+DAY_MS) and asserting the concrete UTC
    // hour/minute below is what actually pins that arithmetic, instead of
    // just checking the item's date against the same formula the
    // implementation uses (which would pass even if both were wrong the
    // same way).
    const sessionDate = toLocalNoon(new Date(Date.now() + DAY_MS).toISOString());
    const classSessionId = crypto.randomUUID();
    await db.insert(classSessions).values({
      id: classSessionId,
      userId,
      courseId,
      date: sessionDate,
      status: null,
      source: 'seed',
      startMin: 605, // 10:05
      endMin: 685, // 11:25
    });
    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: `Attend ${courseSlug}`,
      type: 'attend_class',
      dueDate: sessionDate,
      classSessionId,
      courseId,
      source: 'system',
      dedupeKey: `attend_class:${classSessionId}`,
    });

    const items = await getCalendar(db, userId, Date.now(), Date.now() + 7 * DAY_MS);

    const classItem = items.find((i) => i.id === classSessionId);
    expect(classItem).toBeDefined();
    expect(classItem!.type).toBe('class_session');
    expect(classItem!.title).toBe('Class: TEST 101');

    const startDate = new Date(classItem!.date);
    const endDate = new Date(classItem!.end_date!);
    expect(startDate.getUTCHours()).toBe(10);
    expect(startDate.getUTCMinutes()).toBe(5);
    expect(endDate.getUTCHours()).toBe(11);
    expect(endDate.getUTCMinutes()).toBe(25);
    // Same calendar day as the class session itself, not shifted by a
    // stray 12h offset onto the next day.
    expect(startDate.getUTCDate()).toBe(new Date(sessionDate).getUTCDate());

    expect(classItem!.all_day).toBe(false);
    expect(classItem!.course_id).toBe(courseId);
    expect(classItem!.href).toBe(`/courses/${courseSlug}`);
    expect(classItem!.details).toEqual({
      status: null,
      note: null,
      source: 'seed',
      task_id: taskId,
      start_min: 605,
      end_min: 685,
    });

    // The linked attend_class task_due item must not also appear.
    expect(items.find((i) => i.id === taskId)).toBeUndefined();
  });

  it('does not emit a class_session item for an untimed (start_min/end_min null) session', async () => {
    const sessionDate = Date.now() + DAY_MS;
    const classSessionId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: classSessionId, userId, courseId, date: sessionDate, status: null, source: 'schedule' });

    const items = await getCalendar(db, userId, Date.now(), Date.now() + 7 * DAY_MS);
    expect(items.find((i) => i.id === classSessionId)).toBeUndefined();
  });

  it('does not suppress an attend_class task_due item whose session has no meeting time', async () => {
    const sessionDate = Date.now() + DAY_MS;
    const classSessionId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: classSessionId, userId, courseId, date: sessionDate, status: null, source: 'schedule' });
    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: `Attend ${courseSlug}`,
      type: 'attend_class',
      dueDate: sessionDate,
      classSessionId,
      courseId,
      source: 'system',
      dedupeKey: `attend_class:${classSessionId}`,
    });

    const items = await getCalendar(db, userId, Date.now(), Date.now() + 7 * DAY_MS);
    const item = items.find((i) => i.id === taskId);
    expect(item).toBeDefined();
    expect(item!.type).toBe('task_due');
  });

  it('sorts all items ascending by date', async () => {
    const now = Date.now();
    await db.insert(assessments).values({ id: crypto.randomUUID(), courseId, title: 'Later', type: 'quiz', dueDate: now + 5 * DAY_MS });
    await db.insert(assessments).values({ id: crypto.randomUUID(), courseId, title: 'Sooner', type: 'quiz', dueDate: now + DAY_MS });

    const items = await getCalendar(db, userId, now, now + 7 * DAY_MS);
    const dates = items.map((i) => i.date);
    expect(dates).toEqual([...dates].sort());
  });
});
