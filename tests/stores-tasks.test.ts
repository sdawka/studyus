// Mutating-function coverage for src/lib/stores/tasks.ts (addTask/toggleTask/
// deleteTask) — the selector/hydrateTasks half lives in
// tests/tasksStoreSelectors.test.ts. Mocks global fetch the same way
// tests/quick-quiz.test.ts does; no DOM or cloudflare:test binding involved.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addTask,
  deleteTask,
  tasksById,
  tasksError,
  toggleTask,
  type ApiTask,
} from '../src/lib/stores/tasks';

function task(overrides: Partial<ApiTask> & { id: string }): ApiTask {
  return {
    title: 'Task',
    type: 'todo',
    completed: false,
    completed_at: null,
    due_date: null,
    parent_task_id: null,
    courses: [],
    ...overrides,
  };
}

beforeEach(() => {
  tasksById.set({});
  tasksError.set(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Echoes back `{ ...currentStoreRowForId, ...patchBody }` for PATCH — reading
// the *live* store (not a fixed snapshot) mirrors a real backend PATCH
// response, which always includes the server-stamped completed_at alongside
// whatever the client already applied optimistically. Keyed by the id in the
// URL path; `failFor` makes one id's PATCH respond non-ok with an error
// envelope instead.
function mockTasksFetch(opts: { failFor?: string; failMessage?: string } = {}) {
  const calls: Array<{ method: string; id: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const id = url.split('/').pop()!;
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ method, id, body });

      if (opts.failFor === id && method !== 'GET') {
        return new Response(
          JSON.stringify({ error: { code: 'server_error', message: opts.failMessage ?? `failed to update ${id}` } }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (method === 'DELETE') {
        return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
      }

      const merged = { ...tasksById.get()[id], ...(body as Record<string, unknown>) };
      return new Response(JSON.stringify({ data: merged }), { status: method === 'POST' ? 201 : 200 });
    }),
  );
  return calls;
}

describe('toggleTask', () => {
  it('with cascadeChildren: optimistically completes open children and PATCHes parent then each open child sequentially', async () => {
    const parent = task({ id: 'p', completed: false });
    const childOpen = task({ id: 'c-open', parent_task_id: 'p', completed: false });
    const childDone = task({ id: 'c-done', parent_task_id: 'p', completed: true });
    const byId = { p: parent, 'c-open': childOpen, 'c-done': childDone };
    tasksById.set(byId);

    const calls = mockTasksFetch();

    await toggleTask('p', { cascadeChildren: true });

    const result = tasksById.get();
    expect(result.p.completed).toBe(true);
    expect(result['c-open'].completed).toBe(true);
    expect(result['c-open'].completed_at).not.toBeNull();
    expect(result['c-done'].completed).toBe(true); // already done — left as-is, not re-PATCHed

    const patchCalls = calls.filter((c) => c.method === 'PATCH');
    expect(patchCalls.map((c) => c.id)).toEqual(['p', 'c-open']);
    expect(patchCalls.every((c) => (c.body as any).completed === true)).toBe(true);
    expect(tasksError.get()).toBeNull();
  });

  it('rolls the whole map back to the pre-toggle snapshot when a cascaded child PATCH fails', async () => {
    const parent = task({ id: 'p', completed: false });
    const childOpen = task({ id: 'c-open', parent_task_id: 'p', completed: false });
    const snapshot = { p: parent, 'c-open': childOpen };
    tasksById.set(snapshot);

    mockTasksFetch({ failFor: 'c-open', failMessage: 'child update failed' });

    await toggleTask('p', { cascadeChildren: true });

    const result = tasksById.get();
    expect(result.p).toEqual(parent);
    expect(result['c-open']).toEqual(childOpen);
    expect(tasksError.get()).toBe('child update failed');
  });

  it('rolls back when the parent PATCH itself fails, without touching cascaded children', async () => {
    const parent = task({ id: 'p', completed: false });
    const snapshot = { p: parent };
    tasksById.set(snapshot);

    mockTasksFetch({ failFor: 'p', failMessage: 'parent update failed' });

    await toggleTask('p');

    expect(tasksById.get().p).toEqual(parent);
    expect(tasksError.get()).toBe('parent update failed');
  });
});

describe('deleteTask', () => {
  it('optimistically removes the task (and its children); a non-ok response restores the snapshot', async () => {
    const parent = task({ id: 'p' });
    const child = task({ id: 'c', parent_task_id: 'p' });
    const snapshot = { p: parent, c: child };
    tasksById.set(snapshot);

    mockTasksFetch({ failFor: 'p', failMessage: 'delete failed' });

    await deleteTask('p');

    const result = tasksById.get();
    expect(result.p).toEqual(parent);
    expect(result.c).toEqual(child);
    expect(tasksError.get()).toBe('delete failed');
  });

  it('permanently removes the task and its children on success', async () => {
    const parent = task({ id: 'p' });
    const child = task({ id: 'c', parent_task_id: 'p' });
    const other = task({ id: 'o' });
    const snapshot = { p: parent, c: child, o: other };
    tasksById.set(snapshot);

    mockTasksFetch();

    await deleteTask('p');

    const result = tasksById.get();
    expect(result).toEqual({ o: other });
    expect(tasksError.get()).toBeNull();
  });
});

describe('addTask', () => {
  it('surfaces the server error message and inserts no row on failure', async () => {
    tasksById.set({});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'invalid_input', message: 'Title is required' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(addTask({ title: '' })).rejects.toThrow('Title is required');
    expect(tasksError.get()).toBe('Title is required');
    expect(tasksById.get()).toEqual({});
  });

  it('inserts the server-returned row (normalized) on success', async () => {
    tasksById.set({});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ data: { id: 'new-1', title: 'Study', completed: false, courses: [] } }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const created = await addTask({ title: 'Study' });
    expect(created.id).toBe('new-1');
    expect(created.type).toBe('todo'); // normalized default
    expect(tasksById.get()['new-1']).toEqual(created);
    expect(tasksError.get()).toBeNull();
  });
});
