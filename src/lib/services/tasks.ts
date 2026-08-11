import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, taskCourses, tasks } from '../../db/schema';
import type { CreateTaskInput, UpdateTaskInput } from '../schemas/tasks';
import { NotFoundError } from './util';

async function attachCourses(db: Db, taskId: string) {
  const links = await db
    .select({ id: courses.id, code: courses.code })
    .from(taskCourses)
    .innerJoin(courses, eq(taskCourses.courseId, courses.id))
    .where(eq(taskCourses.taskId, taskId));
  return links;
}

// `completed` in the frozen contract maps to the `done` column.
function shapeTask(task: typeof tasks.$inferSelect, courseLinks: { id: string; code: string }[]) {
  const { done, ...rest } = task;
  return { ...rest, completed: done, courses: courseLinks };
}

export async function listTasks(db: Db, userId: string) {
  const rows = await db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(asc(tasks.dueDate));
  return Promise.all(rows.map(async (t) => shapeTask(t, await attachCourses(db, t.id))));
}

export async function createTask(db: Db, userId: string, input: CreateTaskInput) {
  const id = crypto.randomUUID();
  await db.insert(tasks).values({
    id,
    userId,
    title: input.title,
    dueDate: input.due_date ? Date.parse(input.due_date) : null,
  });

  if (input.course_ids?.length) {
    await db.insert(taskCourses).values(input.course_ids.map((courseId) => ({ id: crypto.randomUUID(), taskId: id, courseId })));
  }

  const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return shapeTask(rows[0], await attachCourses(db, id));
}

async function requireOwnedTask(db: Db, userId: string, taskId: string) {
  const rows = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId))).limit(1);
  const task = rows[0];
  if (!task) throw new NotFoundError('Task');
  return task;
}

export async function updateTask(db: Db, userId: string, taskId: string, input: UpdateTaskInput) {
  await requireOwnedTask(db, userId, taskId);

  const patch: Partial<typeof tasks.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.due_date !== undefined) patch.dueDate = input.due_date ? Date.parse(input.due_date) : null;
  if (input.completed !== undefined) patch.done = input.completed;
  await db.update(tasks).set(patch).where(eq(tasks.id, taskId));

  if (input.course_ids !== undefined) {
    await db.delete(taskCourses).where(eq(taskCourses.taskId, taskId));
    if (input.course_ids.length) {
      await db.insert(taskCourses).values(input.course_ids.map((courseId) => ({ id: crypto.randomUUID(), taskId, courseId })));
    }
  }

  const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return shapeTask(rows[0], await attachCourses(db, taskId));
}

export async function deleteTask(db: Db, userId: string, taskId: string) {
  await requireOwnedTask(db, userId, taskId);
  await db.delete(tasks).where(eq(tasks.id, taskId));
}
