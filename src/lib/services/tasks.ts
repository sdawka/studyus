import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { classSessions, courses, taskCourses, tasks } from '../../db/schema';
import type { CreateTaskInput, UpdateTaskInput } from '../schemas/tasks';
import { ConflictError, NotFoundError } from './util';
import { sweepTasks } from './taskSweep';

async function attachCourses(db: Db, taskId: string) {
  const links = await db
    .select({ id: courses.id, code: courses.code })
    .from(taskCourses)
    .innerJoin(courses, eq(taskCourses.courseId, courses.id))
    .where(eq(taskCourses.taskId, taskId));
  return links;
}

// Grouped inArray fetch for listTasks — one query for every task in the
// list instead of one attachCourses() round-trip per task (mirrors the
// task_courses fix in calendar.ts:56-62).
async function attachCoursesBatch(db: Db, taskIds: string[]) {
  const map = new Map<string, { id: string; code: string }[]>();
  if (taskIds.length === 0) return map;
  const links = await db
    .select({ taskId: taskCourses.taskId, id: courses.id, code: courses.code })
    .from(taskCourses)
    .innerJoin(courses, eq(taskCourses.courseId, courses.id))
    .where(inArray(taskCourses.taskId, taskIds));
  for (const link of links) {
    const list = map.get(link.taskId) ?? [];
    list.push({ id: link.id, code: link.code });
    map.set(link.taskId, list);
  }
  return map;
}

// `completed` in the frozen contract maps to the `done` column.
// `dismissedAt`/`dedupeKey` are internal-only (system-task soft delete /
// sweep idempotency) and never serialized.
function shapeTask(task: typeof tasks.$inferSelect, courseLinks: { id: string; code: string }[]) {
  const { done, dismissedAt, dedupeKey, ...rest } = task;
  return { ...rest, completed: done, courses: courseLinks };
}

async function requireOwnedTask(db: Db, userId: string, taskId: string) {
  const rows = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId))).limit(1);
  const task = rows[0];
  if (!task) throw new NotFoundError('Task');
  return task;
}

export async function listTasks(db: Db, userId: string) {
  await sweepTasks(db, userId);

  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNull(tasks.dismissedAt)))
    .orderBy(asc(tasks.dueDate), asc(tasks.createdAt));

  const courseLinksByTask = await attachCoursesBatch(db, rows.map((t) => t.id));
  return rows.map((t) => shapeTask(t, courseLinksByTask.get(t.id) ?? []));
}

export async function createTask(db: Db, userId: string, input: CreateTaskInput) {
  if (input.parent_task_id) {
    const parent = await requireOwnedTask(db, userId, input.parent_task_id);
    // One level of subtasks only: a parent that itself has a parent can't
    // take on a child.
    if (parent.parentTaskId) throw new ConflictError('Subtasks cannot be nested');
  }

  const id = crypto.randomUUID();
  await db.insert(tasks).values({
    id,
    userId,
    title: input.title,
    description: input.description ?? null,
    dueDate: input.due_date ? Date.parse(input.due_date) : null,
    parentTaskId: input.parent_task_id ?? null,
  });

  if (input.course_ids?.length) {
    await db.insert(taskCourses).values(input.course_ids.map((courseId) => ({ id: crypto.randomUUID(), taskId: id, courseId })));
  }

  const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return shapeTask(rows[0], await attachCourses(db, id));
}

export async function updateTask(db: Db, userId: string, taskId: string, input: UpdateTaskInput) {
  const existing = await requireOwnedTask(db, userId, taskId);

  const patch: Partial<typeof tasks.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.due_date !== undefined) patch.dueDate = input.due_date ? Date.parse(input.due_date) : null;
  if (input.completed !== undefined) {
    patch.done = input.completed;
    // Stamp/clear completed_at only on an actual transition — a redundant
    // true→true (or false→false) PATCH leaves the existing stamp alone.
    if (input.completed && !existing.done) patch.completedAt = Date.now();
    else if (!input.completed && existing.done) patch.completedAt = null;
  }
  await db.update(tasks).set(patch).where(eq(tasks.id, taskId));

  if (input.course_ids !== undefined) {
    await db.delete(taskCourses).where(eq(taskCourses.taskId, taskId));
    if (input.course_ids.length) {
      await db.insert(taskCourses).values(input.course_ids.map((courseId) => ({ id: crypto.randomUUID(), taskId, courseId })));
    }
  }

  // Two-way sync with AttendanceCard: an attend_class task's completion
  // drives its linked class session's status directly (raw update, never
  // classSessions.ts's updateClassSessionStatus — that would recurse back
  // into a task sync from the other direction).
  if (existing.type === 'attend_class' && existing.classSessionId && input.completed !== undefined) {
    await db
      .update(classSessions)
      .set({ status: input.completed ? 'attended' : null })
      .where(eq(classSessions.id, existing.classSessionId));
  }

  const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return shapeTask(rows[0], await attachCourses(db, taskId));
}

export async function deleteTask(db: Db, userId: string, taskId: string) {
  const task = await requireOwnedTask(db, userId, taskId);

  if (task.source === 'system') {
    // Soft delete: the row (and its dedupe_key) survives so the generating
    // sweep can never resurrect it. Children are still hard-deleted.
    await db.delete(tasks).where(eq(tasks.parentTaskId, taskId));
    await db.update(tasks).set({ dismissedAt: Date.now() }).where(eq(tasks.id, taskId));
  } else {
    await db.delete(tasks).where(eq(tasks.id, taskId));
  }
}
