import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { assessments, branches, courses, kcs, notifications, studySessions, tasks, users } from '../src/db/schema';
import { updateAssessment } from '../src/lib/services/assessments';
import {
  createNotification,
  listNotifications,
  markAllRead,
  markRead,
  sweepNotifications,
} from '../src/lib/services/notifications';

const db = getDb(env.DB);

let userId: string;
let courseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
});

describe('sweepNotifications', () => {
  it('generates one row per source (assessment_due, task_overdue, kc_review, session_unfinished) and is idempotent', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const branchId = crypto.randomUUID();
    const kcId = crypto.randomUUID();
    await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
    await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Review KC', status: 'review', lastEventAt: now });

    const assessmentId = crypto.randomUUID();
    await db.insert(assessments).values({ id: assessmentId, courseId, title: 'Midterm', type: 'midterm', dueDate: now + day });

    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({ id: taskId, userId, title: 'Overdue task', dueDate: now - day, done: false });

    const sessionId = crypto.randomUUID();
    await db.insert(studySessions).values({ id: sessionId, userId, intendedEventType: 'practice_done', startedAt: now - 7 * 60 * 60 * 1000 });

    await sweepNotifications(db, userId, now);
    const first = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(first).toHaveLength(4);
    expect(new Set(first.map((n) => n.type))).toEqual(
      new Set(['assessment_due', 'task_overdue', 'kc_review', 'session_unfinished']),
    );

    // Re-running must not create duplicates (ON CONFLICT(dedupe_key) DO NOTHING).
    await sweepNotifications(db, userId, now);
    const second = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(second).toHaveLength(4);
  });

  it('does not flag a graded assessment as due, a completed task as overdue, or a completed session as unfinished', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const gradedAssessmentId = crypto.randomUUID();
    await db.insert(assessments).values({
      id: gradedAssessmentId,
      courseId,
      title: 'Graded quiz',
      type: 'quiz',
      dueDate: now + day,
      gradeReceived: 90,
      gradeMax: 100,
    });

    const doneTaskId = crypto.randomUUID();
    await db.insert(tasks).values({ id: doneTaskId, userId, title: 'Finished task', dueDate: now - day, done: true });

    const finishedSessionId = crypto.randomUUID();
    await db.insert(studySessions).values({
      id: finishedSessionId,
      userId,
      intendedEventType: 'practice_done',
      startedAt: now - 7 * 60 * 60 * 1000,
      endedAt: now - 6 * 60 * 60 * 1000,
    });

    await sweepNotifications(db, userId, now);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(rows).toHaveLength(0);
  });
});

describe('collectTaskOverdue scoping', () => {
  it('skips a system task and a dismissed user task, but still notifies for a plain overdue user task', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const systemTaskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: systemTaskId,
      userId,
      title: 'Attend TEST 101',
      type: 'attend_class',
      dueDate: now - day,
      done: false,
      source: 'system',
      dedupeKey: `attend_class:${systemTaskId}`,
    });

    const dismissedTaskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: dismissedTaskId,
      userId,
      title: 'Dismissed task',
      dueDate: now - day,
      done: false,
      dismissedAt: now,
    });

    const userTaskId = crypto.randomUUID();
    await db.insert(tasks).values({ id: userTaskId, userId, title: 'Plain overdue task', dueDate: now - day, done: false });

    await sweepNotifications(db, userId, now);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
    const overdueRows = rows.filter((r) => r.type === 'task_overdue');
    expect(overdueRows).toHaveLength(1);
    expect(overdueRows[0].dedupeKey).toBe(`task_overdue:${userTaskId}:${now - day}`);
  });
});

describe('grade_recorded producer (assessments service)', () => {
  it('fires once on the null→value grade transition and is dedupe-guarded against re-creation', async () => {
    const assessmentId = crypto.randomUUID();
    await db.insert(assessments).values({ id: assessmentId, courseId, title: 'Quiz 1', type: 'quiz', gradeMax: 100 });

    await updateAssessment(db, userId, assessmentId, { grade_received: 90 });
    const rows = await db.select().from(notifications).where(eq(notifications.type, 'grade_recorded'));
    expect(rows).toHaveLength(1);
    expect(rows[0].dedupeKey).toBe(`grade_recorded:${assessmentId}`);
    expect(rows[0].title).toContain('90%');

    // Direct re-create with the same dedupe key (what a second grade edit on
    // the same assessment would attempt) must no-op, not duplicate.
    await createNotification(db, {
      userId,
      type: 'grade_recorded',
      title: 'duplicate attempt',
      href: '/courses/test',
      dedupeKey: `grade_recorded:${assessmentId}`,
    });
    const rowsAfter = await db.select().from(notifications).where(eq(notifications.type, 'grade_recorded'));
    expect(rowsAfter).toHaveLength(1);
    expect(rowsAfter[0].title).not.toBe('duplicate attempt');
  });
});

describe('retention', () => {
  it('purges read notifications older than 30 days', async () => {
    const now = Date.now();
    const oldRead = now - 40 * 24 * 60 * 60 * 1000;
    await db.insert(notifications).values({
      id: crypto.randomUUID(),
      userId,
      type: 'task_overdue',
      title: 'stale read',
      href: '/tasks',
      dedupeKey: 'stale-1',
      readAt: oldRead,
      createdAt: oldRead,
    });

    await sweepNotifications(db, userId, now);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(rows.find((r) => r.dedupeKey === 'stale-1')).toBeUndefined();
  });

  it('trims to the newest 100 notifications per user', async () => {
    const now = Date.now();
    const rows = Array.from({ length: 105 }, (_, i) => ({
      id: crypto.randomUUID(),
      userId,
      type: 'task_overdue' as const,
      title: `n${i}`,
      href: '/tasks',
      dedupeKey: `bulk:${i}`,
      createdAt: now - i * 1000,
    }));
    for (const row of rows) {
      await db.insert(notifications).values(row);
    }

    await sweepNotifications(db, userId, now);
    const remaining = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(remaining.length).toBeLessThanOrEqual(100);
  });
});

describe('markRead / markAllRead', () => {
  it('marks a single notification read without touching others', async () => {
    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    await db.insert(notifications).values([
      { id: idA, userId, type: 'task_overdue', title: 'a', href: '/tasks', dedupeKey: 'ra1', createdAt: Date.now() },
      { id: idB, userId, type: 'task_overdue', title: 'b', href: '/tasks', dedupeKey: 'ra2', createdAt: Date.now() },
    ]);

    await markRead(db, userId, idA);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(rows.find((r) => r.id === idA)?.readAt).not.toBeNull();
    expect(rows.find((r) => r.id === idB)?.readAt).toBeNull();
  });

  it('marks every unread notification read', async () => {
    await db.insert(notifications).values([
      { id: crypto.randomUUID(), userId, type: 'task_overdue', title: 'a', href: '/tasks', dedupeKey: 'raa1', createdAt: Date.now() },
      { id: crypto.randomUUID(), userId, type: 'task_overdue', title: 'b', href: '/tasks', dedupeKey: 'raa2', createdAt: Date.now() },
    ]);

    await markAllRead(db, userId);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(rows.every((r) => r.readAt !== null)).toBe(true);
  });
});

describe('listNotifications', () => {
  it('runs the sweep and returns unread_count alongside the rows', async () => {
    const now = Date.now();
    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({ id: taskId, userId, title: 'Overdue task', dueDate: now - 24 * 60 * 60 * 1000, done: false });

    const { notifications: rows, unread_count } = await listNotifications(db, userId, {});
    expect(rows).toHaveLength(1);
    expect(unread_count).toBe(1);

    await markRead(db, userId, rows[0].id);
    const after = await listNotifications(db, userId, {});
    expect(after.unread_count).toBe(0);
  });

  it('unread filter returns only unread rows', async () => {
    await db.insert(notifications).values([
      { id: crypto.randomUUID(), userId, type: 'task_overdue', title: 'a', href: '/tasks', dedupeKey: 'u1', createdAt: Date.now(), readAt: Date.now() },
      { id: crypto.randomUUID(), userId, type: 'task_overdue', title: 'b', href: '/tasks', dedupeKey: 'u2', createdAt: Date.now() },
    ]);

    const { notifications: rows, unread_count } = await listNotifications(db, userId, { unread: true });
    expect(rows).toHaveLength(1);
    expect(unread_count).toBe(1);
  });
});
