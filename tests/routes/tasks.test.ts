import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/client';
import { classSessions, courses, tasks, users } from '../../src/db/schema';
import { DELETE as deleteTaskRoute, PATCH as patchTask } from '../../src/pages/api/v1/tasks/[id]';
import { GET as getTasks, POST as postTask } from '../../src/pages/api/v1/tasks/index';

const db = getDb(env.DB);

let userId: string;
let courseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
});

function postRequest(body: unknown) {
  return new Request('http://local.test/api/v1/tasks', { method: 'POST', body: JSON.stringify(body) });
}

function patchRequest(id: string, body: unknown) {
  return new Request(`http://local.test/api/v1/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

describe('POST /api/v1/tasks — subtasks', () => {
  it('201s a task nested one level under a parent', async () => {
    const parentRes = await postTask({ request: postRequest({ title: 'Parent' }), locals: { user: { id: userId } } } as any);
    expect(parentRes.status).toBe(201);
    const parent = ((await parentRes.json()) as any).data;

    const childRes = await postTask({
      request: postRequest({ title: 'Child', parent_task_id: parent.id }),
      locals: { user: { id: userId } },
    } as any);
    expect(childRes.status).toBe(201);
    const child = ((await childRes.json()) as any).data;
    expect(child.parent_task_id).toBe(parent.id);
  });

  it('409s nesting a subtask under a subtask', async () => {
    const parentRes = await postTask({ request: postRequest({ title: 'Parent' }), locals: { user: { id: userId } } } as any);
    const parent = ((await parentRes.json()) as any).data;

    const childRes = await postTask({
      request: postRequest({ title: 'Child', parent_task_id: parent.id }),
      locals: { user: { id: userId } },
    } as any);
    const child = ((await childRes.json()) as any).data;

    const grandchildRes = await postTask({
      request: postRequest({ title: 'Grandchild', parent_task_id: child.id }),
      locals: { user: { id: userId } },
    } as any);
    expect(grandchildRes.status).toBe(409);
    const body = (await grandchildRes.json()) as any;
    expect(body.error.message).toBe('Subtasks cannot be nested');
  });
});

describe('PATCH /api/v1/tasks/:id — completion', () => {
  it('returns completed_at as an ISO string after completing, and null again after uncompleting', async () => {
    const createRes = await postTask({ request: postRequest({ title: 'Task' }), locals: { user: { id: userId } } } as any);
    const created = ((await createRes.json()) as any).data;
    expect(created.completed_at).toBeNull();

    const completeRes = await patchTask({
      params: { id: created.id },
      request: patchRequest(created.id, { completed: true }),
      locals: { user: { id: userId } },
    } as any);
    const completed = ((await completeRes.json()) as any).data;
    expect(completed.completed).toBe(true);
    expect(typeof completed.completed_at).toBe('string');
    expect(() => new Date(completed.completed_at).toISOString()).not.toThrow();

    const uncompleteRes = await patchTask({
      params: { id: created.id },
      request: patchRequest(created.id, { completed: false }),
      locals: { user: { id: userId } },
    } as any);
    const uncompleted = ((await uncompleteRes.json()) as any).data;
    expect(uncompleted.completed).toBe(false);
    expect(uncompleted.completed_at).toBeNull();
  });
});

describe('PATCH /api/v1/tasks/:id — attend_class sync', () => {
  it('flips the linked class_sessions.status in both directions', async () => {
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

    await patchTask({
      params: { id: taskId },
      request: patchRequest(taskId, { completed: true }),
      locals: { user: { id: userId } },
    } as any);
    let sessionRows = await db.select().from(classSessions).where(eq(classSessions.id, sessionId));
    expect(sessionRows[0].status).toBe('attended');

    await patchTask({
      params: { id: taskId },
      request: patchRequest(taskId, { completed: false }),
      locals: { user: { id: userId } },
    } as any);
    sessionRows = await db.select().from(classSessions).where(eq(classSessions.id, sessionId));
    expect(sessionRows[0].status).toBeNull();
  });
});

describe('DELETE /api/v1/tasks/:id — system dismissal', () => {
  it('excludes the dismissed task from a subsequent GET /tasks', async () => {
    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: 'Attend TEST 101',
      type: 'attend_class',
      source: 'system',
      dedupeKey: 'attend_class:xyz',
      dueDate: Date.now(),
    });

    const deleteRes = await deleteTaskRoute({ params: { id: taskId }, locals: { user: { id: userId } } } as any);
    expect(deleteRes.status).toBe(200);

    const listRes = await getTasks({ locals: { user: { id: userId } } } as any);
    const list = ((await listRes.json()) as any).data;
    expect(list.find((t: any) => t.id === taskId)).toBeUndefined();

    const row = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(row[0].dismissedAt).not.toBeNull();
  });

  it('hard-deletes a user task (GET /tasks omits it and the row is gone)', async () => {
    const createRes = await postTask({ request: postRequest({ title: 'Task' }), locals: { user: { id: userId } } } as any);
    const created = ((await createRes.json()) as any).data;

    const deleteRes = await deleteTaskRoute({ params: { id: created.id }, locals: { user: { id: userId } } } as any);
    expect(deleteRes.status).toBe(200);

    const row = await db.select().from(tasks).where(eq(tasks.id, created.id));
    expect(row).toHaveLength(0);
  });
});
