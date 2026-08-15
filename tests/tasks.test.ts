import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { classSessions, courses, tasks, users } from '../src/db/schema';
import { localNoon } from '../src/lib/services/classSessions';
import { createTask, deleteTask, listTasks, updateTask } from '../src/lib/services/tasks';
import { sweepTasks } from '../src/lib/services/taskSweep';
import { ConflictError, NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);

let userId: string;
let courseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
});

describe('createTask', () => {
  it('persists description', async () => {
    const created = await createTask(db, userId, { title: 'Read chapter 3', description: 'pages 40-55' });
    expect(created.description).toBe('pages 40-55');

    const rows = await db.select().from(tasks).where(eq(tasks.id, created.id));
    expect(rows[0].description).toBe('pages 40-55');
  });

  it('links a subtask to its parent one level deep', async () => {
    const parent = await createTask(db, userId, { title: 'Parent' });
    const child = await createTask(db, userId, { title: 'Child', parent_task_id: parent.id });
    expect(child.parentTaskId).toBe(parent.id);
  });

  it('rejects nesting a subtask under a subtask with ConflictError', async () => {
    const parent = await createTask(db, userId, { title: 'Parent' });
    const child = await createTask(db, userId, { title: 'Child', parent_task_id: parent.id });
    await expect(createTask(db, userId, { title: 'Grandchild', parent_task_id: child.id })).rejects.toThrow(ConflictError);
  });
});

describe('updateTask — completed_at stamping', () => {
  it('stamps completed_at on the false→true transition and clears it on true→false', async () => {
    const created = await createTask(db, userId, { title: 'Task' });
    expect(created.completedAt).toBeNull();

    const completed = await updateTask(db, userId, created.id, { completed: true });
    expect(completed.completed).toBe(true);
    expect(completed.completedAt).not.toBeNull();

    const uncompleted = await updateTask(db, userId, created.id, { completed: false });
    expect(uncompleted.completed).toBe(false);
    expect(uncompleted.completedAt).toBeNull();
  });

  it('does not re-stamp completed_at on a redundant true→true update', async () => {
    const created = await createTask(db, userId, { title: 'Task' });
    const completed = await updateTask(db, userId, created.id, { completed: true });
    const firstStamp = completed.completedAt;

    const again = await updateTask(db, userId, created.id, { completed: true });
    expect(again.completedAt).toEqual(firstStamp);
  });

  it('persists description updates, including clearing to null', async () => {
    const created = await createTask(db, userId, { title: 'Task', description: 'first' });
    const updated = await updateTask(db, userId, created.id, { description: 'second' });
    expect(updated.description).toBe('second');

    const cleared = await updateTask(db, userId, created.id, { description: null });
    expect(cleared.description).toBeNull();
  });
});

describe('updateTask — attend_class two-way sync', () => {
  it('flips the linked class session status in both directions via a raw update (not the class-session service)', async () => {
    const sessionId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: sessionId, userId, courseId, date: Date.now(), status: null, source: 'manual' });

    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: 'Attend TEST 101',
      type: 'attend_class',
      classSessionId: sessionId,
      source: 'system',
      dedupeKey: `attend_class:${sessionId}`,
    });

    await updateTask(db, userId, taskId, { completed: true });
    let sessionRows = await db.select().from(classSessions).where(eq(classSessions.id, sessionId));
    expect(sessionRows[0].status).toBe('attended');

    await updateTask(db, userId, taskId, { completed: false });
    sessionRows = await db.select().from(classSessions).where(eq(classSessions.id, sessionId));
    expect(sessionRows[0].status).toBeNull();
  });

  it('leaves the class session alone when the PATCH does not touch completed', async () => {
    const sessionId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: sessionId, userId, courseId, date: Date.now(), status: 'attended', source: 'manual' });

    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: 'Attend TEST 101',
      type: 'attend_class',
      classSessionId: sessionId,
      source: 'system',
      dedupeKey: `attend_class:${sessionId}`,
    });

    await updateTask(db, userId, taskId, { title: 'Attend TEST 101 (renamed)' });
    const sessionRows = await db.select().from(classSessions).where(eq(classSessions.id, sessionId));
    expect(sessionRows[0].status).toBe('attended');
  });
});

describe('deleteTask', () => {
  it('hard-deletes a user task and cascades to its children', async () => {
    const parent = await createTask(db, userId, { title: 'Parent' });
    const child = await createTask(db, userId, { title: 'Child', parent_task_id: parent.id });

    await deleteTask(db, userId, parent.id);

    const remaining = await db.select().from(tasks).where(eq(tasks.userId, userId));
    expect(remaining).toHaveLength(0);
    const childRow = await db.select().from(tasks).where(eq(tasks.id, child.id));
    expect(childRow).toHaveLength(0);
  });

  it('soft-dismisses a system task (row + dedupe_key survive) and hard-deletes its children', async () => {
    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: 'Attend TEST 101',
      type: 'attend_class',
      source: 'system',
      dedupeKey: `attend_class:${taskId}`,
    });
    const childId = crypto.randomUUID();
    await db.insert(tasks).values({ id: childId, userId, title: 'sub', parentTaskId: taskId });

    await deleteTask(db, userId, taskId);

    const row = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(row).toHaveLength(1);
    expect(row[0].dismissedAt).not.toBeNull();
    expect(row[0].dedupeKey).toBe(`attend_class:${taskId}`);

    const child = await db.select().from(tasks).where(eq(tasks.id, childId));
    expect(child).toHaveLength(0);
  });

  it('excludes a dismissed system task from listTasks, and re-running sweepTasks does not resurrect it (real ON CONFLICT DO NOTHING collision)', async () => {
    const now = Date.now();
    // A real class_sessions row still inside collectAttendClass's ±7d
    // window — so re-sweeping genuinely retries the insert this dismissed
    // row's dedupe_key collides with, unlike a dedupe_key with no backing
    // row for a collector to ever regenerate (see the pattern in
    // tests/taskSweep.test.ts's "dismissal" describe block).
    const sessionId = crypto.randomUUID();
    await db.insert(classSessions).values({ id: sessionId, userId, courseId, date: localNoon(now), status: null, source: 'schedule' });

    // Seeded directly (as sweepTasks itself would produce it) so this test
    // can exercise deleteTask's soft-dismiss path specifically, rather than
    // taskSweep.test.ts's raw-SQL dismissal.
    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: 'Attend TEST 101',
      type: 'attend_class',
      classSessionId: sessionId,
      source: 'system',
      dedupeKey: `attend_class:${sessionId}`,
      dueDate: localNoon(now),
    });

    await deleteTask(db, userId, taskId);

    const list = await listTasks(db, userId);
    expect(list.find((t) => t.id === taskId)).toBeUndefined();

    await sweepTasks(db, userId, now);
    const listAfterSweep = await listTasks(db, userId);
    expect(listAfterSweep.find((t) => t.id === taskId)).toBeUndefined();

    const row = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(row).toHaveLength(1);
    expect(row[0].id).toBe(taskId);
    expect(row[0].dismissedAt).not.toBeNull();
  });

  it('404s for a cross-user task id', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    const created = await createTask(db, userId, { title: 'Task' });

    await expect(deleteTask(db, otherUserId, created.id)).rejects.toThrow(NotFoundError);
  });
});

describe('listTasks', () => {
  it('orders by due_date ascending then created_at ascending, and attaches linked courses via a grouped query', async () => {
    const now = Date.now();
    const later = await createTask(db, userId, {
      title: 'Later',
      due_date: new Date(now + 2 * 86_400_000).toISOString(),
      course_ids: [courseId],
    });
    const sooner = await createTask(db, userId, { title: 'Sooner', due_date: new Date(now + 86_400_000).toISOString() });

    const list = await listTasks(db, userId);
    const ids = list.map((t) => t.id);
    expect(ids.indexOf(sooner.id)).toBeLessThan(ids.indexOf(later.id));

    const laterInList = list.find((t) => t.id === later.id);
    expect(laterInList?.courses).toEqual([{ id: courseId, code: 'TEST 101' }]);
  });
});
