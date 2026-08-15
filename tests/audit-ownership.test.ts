// Audit fixes: IDOR guards on client-supplied foreign-key ids that
// previously wrote straight into a join table with no ownership check.
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, kcs, noteLinks, taskCourses, users } from '../src/db/schema';
import { createNote, updateNote } from '../src/lib/services/notes';
import { createTask, updateTask } from '../src/lib/services/tasks';
import { NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let otherUserId: string;
let otherCourseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  otherUserId = crypto.randomUUID();
  otherCourseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
  await db.insert(courses).values({
    id: otherCourseId,
    userId: otherUserId,
    code: 'OTHER 101',
    slug: `other-${otherCourseId}`,
    title: 'Other Course',
  });
});

describe('createTask — course_ids ownership', () => {
  it('404s when a course_id belongs to another user, and inserts no task_courses row', async () => {
    await expect(createTask(db, userId, { title: 'Task', course_ids: [otherCourseId] })).rejects.toThrow(NotFoundError);

    const links = await db.select().from(taskCourses).where(eq(taskCourses.courseId, otherCourseId));
    expect(links).toHaveLength(0);
  });

  it('still links a course the user actually owns', async () => {
    const created = await createTask(db, userId, { title: 'Task', course_ids: [courseId] });
    expect(created.courses).toEqual([{ id: courseId, code: 'TEST 101' }]);
  });

  it('404s the whole request when one of several course_ids is foreign, even if others are owned', async () => {
    await expect(
      createTask(db, userId, { title: 'Task', course_ids: [courseId, otherCourseId] }),
    ).rejects.toThrow(NotFoundError);
    const links = await db.select().from(taskCourses).where(eq(taskCourses.courseId, courseId));
    expect(links).toHaveLength(0);
  });
});

describe('updateTask — course_ids ownership', () => {
  it('404s on a foreign course_id and leaves the task’s existing links untouched', async () => {
    const created = await createTask(db, userId, { title: 'Task', course_ids: [courseId] });

    await expect(updateTask(db, userId, created.id, { course_ids: [otherCourseId] })).rejects.toThrow(NotFoundError);

    const links = await db.select().from(taskCourses).where(eq(taskCourses.taskId, created.id));
    expect(links.map((l) => l.courseId)).toEqual([courseId]);
  });
});

describe('notes links — course_id/kc_id ownership', () => {
  async function makeOwnKc() {
    const branchId = crypto.randomUUID();
    const kcId = crypto.randomUUID();
    await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
    await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'KC' });
    return kcId;
  }

  async function makeForeignKc() {
    const branchId = crypto.randomUUID();
    const kcId = crypto.randomUUID();
    await db.insert(branches).values({ id: branchId, courseId: otherCourseId, name: 'Foreign Branch' });
    await db.insert(kcs).values({ id: kcId, branchId, courseId: otherCourseId, name: 'Foreign KC' });
    return kcId;
  }

  it('createNote 404s on a foreign course_id and creates no note row', async () => {
    await expect(
      createNote(db, userId, { title: 'Note', content: '', links: [{ course_id: otherCourseId }] }),
    ).rejects.toThrow(NotFoundError);
  });

  it('createNote 404s on a foreign kc_id', async () => {
    const foreignKcId = await makeForeignKc();
    await expect(
      createNote(db, userId, { title: 'Note', content: '', links: [{ kc_id: foreignKcId }] }),
    ).rejects.toThrow(NotFoundError);
  });

  it('createNote succeeds and links an owned course and kc', async () => {
    const kcId = await makeOwnKc();
    const note = await createNote(db, userId, {
      title: 'Note',
      content: '',
      links: [{ course_id: courseId }, { kc_id: kcId }],
    });
    expect(note.links).toHaveLength(2);
  });

  it('updateNote 404s on a foreign course_id and leaves the old links in place', async () => {
    const kcId = await makeOwnKc();
    const note = await createNote(db, userId, { title: 'Note', content: '', links: [{ kc_id: kcId }] });

    await expect(updateNote(db, userId, note.id, { links: [{ course_id: otherCourseId }] })).rejects.toThrow(NotFoundError);

    const links = await db.select().from(noteLinks).where(eq(noteLinks.noteId, note.id));
    expect(links).toHaveLength(1);
    expect(links[0].kcId).toBe(kcId);
  });
});
