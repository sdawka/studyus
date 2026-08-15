// Pure-function coverage for src/lib/stores/tasks.ts: the selector helpers
// (bucketByDue, selectChildren, selectOpen, selectForCourse) and
// hydrateTasks' first-hydrator-wins map semantics. No fetch/DOM involved —
// importing the store module only creates atoms (addTask/toggleTask/
// deleteTask are covered separately in tests/stores-tasks.test.ts, not
// here), so this runs fine in the workers test pool alongside the
// DB-backed suites.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bucketByDue,
  hydrateTasks,
  selectChildren,
  selectForCourse,
  selectOpen,
  tasksById,
  tasksError,
  tasksStatus,
  type ApiTask,
} from '../src/lib/stores/tasks';

function task(overrides: Partial<ApiTask> & { id: string }): ApiTask {
  return {
    title: 'Task',
    type: 'todo',
    completed: false,
    due_date: null,
    courses: [],
    ...overrides,
  };
}

beforeEach(() => {
  tasksById.set({});
  tasksStatus.set('idle');
  tasksError.set(null);
});

describe('bucketByDue', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('buckets a past-due plain task as overdue', () => {
    const t = task({ id: 't1', type: 'todo', due_date: '2026-06-10T12:00:00.000Z' });
    const buckets = bucketByDue([t], now);
    expect(buckets.overdue).toEqual([t]);
    expect(buckets.catchUp).toEqual([]);
  });

  it('never puts a past-due attend_class task in overdue — it lands in catchUp', () => {
    const t = task({ id: 't2', type: 'attend_class', due_date: '2026-06-10T12:00:00.000Z' });
    const buckets = bucketByDue([t], now);
    expect(buckets.overdue).toEqual([]);
    expect(buckets.catchUp).toEqual([t]);
  });

  it('buckets a task due today, at the day boundary, as today (not overdue or next)', () => {
    const dueEarlyToday = task({ id: 't3', due_date: '2026-06-15T00:30:00.000Z' });
    const dueLateToday = task({ id: 't4', due_date: '2026-06-15T23:30:00.000Z' });
    const buckets = bucketByDue([dueEarlyToday, dueLateToday], now);
    expect(buckets.today.map((t) => t.id)).toEqual(['t3', 't4']);
    expect(buckets.overdue).toEqual([]);
    expect(buckets.next.map((t) => t.id)).not.toContain('t3');
  });

  it('buckets a future-due task as next', () => {
    const t = task({ id: 't5', due_date: '2026-06-20T12:00:00.000Z' });
    const buckets = bucketByDue([t], now);
    expect(buckets.next).toEqual([t]);
  });

  it('appends undated tasks as a tail of next, after every dated entry', () => {
    const dated = task({ id: 'dated', due_date: '2026-06-25T12:00:00.000Z' });
    const undated = task({ id: 'undated', type: 'stale_kc', due_date: null });
    const buckets = bucketByDue([undated, dated], now);
    expect(buckets.next.map((t) => t.id)).toEqual(['dated', 'undated']);
  });

  it('sorts each bucket by due date ascending', () => {
    const later = task({ id: 'later', due_date: '2026-06-22T12:00:00.000Z' });
    const sooner = task({ id: 'sooner', due_date: '2026-06-18T12:00:00.000Z' });
    const buckets = bucketByDue([later, sooner], now);
    expect(buckets.next.map((t) => t.id)).toEqual(['sooner', 'later']);
  });
});

describe('selectChildren', () => {
  it('returns only tasks whose parent_task_id matches', () => {
    const parent = task({ id: 'p1' });
    const child1 = task({ id: 'c1', parent_task_id: 'p1' });
    const child2 = task({ id: 'c2', parent_task_id: 'p1' });
    const other = task({ id: 'o1', parent_task_id: 'p2' });
    const topLevel = task({ id: 't1' });

    const children = selectChildren([parent, child1, child2, other, topLevel], 'p1');
    expect(children.map((t) => t.id).sort()).toEqual(['c1', 'c2']);
  });

  it('returns an empty array when a task has no children', () => {
    const t = task({ id: 'lonely' });
    expect(selectChildren([t], 'lonely')).toEqual([]);
  });
});

describe('selectOpen', () => {
  it('excludes completed tasks', () => {
    const open = task({ id: 'open', completed: false });
    const done = task({ id: 'done', completed: true });
    expect(selectOpen([open, done]).map((t) => t.id)).toEqual(['open']);
  });
});

describe('selectForCourse', () => {
  it('matches on the origin course_id (sweep-generated tasks)', () => {
    const t = task({ id: 't1', course_id: 'course-a' });
    expect(selectForCourse([t], 'course-a')).toEqual([t]);
    expect(selectForCourse([t], 'course-b')).toEqual([]);
  });

  it('matches on the linked courses[] array (user tasks via course_ids)', () => {
    const t = task({ id: 't1', courses: [{ id: 'course-a', code: 'CS101' }] });
    expect(selectForCourse([t], 'course-a')).toEqual([t]);
    expect(selectForCourse([t], 'course-b')).toEqual([]);
  });
});

describe('hydrateTasks', () => {
  it('replaces the map and marks the store ready on the first hydration', () => {
    const t = task({ id: 't1' });
    hydrateTasks([t]);
    expect(tasksStatus.get()).toBe('ready');
    expect(tasksById.get()).toEqual({ t1: t });
  });

  it('first-hydrator-wins: once ready, a later hydration only inserts unknown ids', () => {
    const original = task({ id: 't1', title: 'Original title' });
    hydrateTasks([original]);
    expect(tasksStatus.get()).toBe('ready');

    const conflicting = task({ id: 't1', title: 'Different title from a second hydrator' });
    const newTask = task({ id: 't2', title: 'New task' });
    hydrateTasks([conflicting, newTask]);

    const byId = tasksById.get();
    // Existing id keeps the first hydrator's data, untouched.
    expect(byId.t1).toEqual(original);
    // Unknown id from the second hydrator is still inserted.
    expect(byId.t2).toEqual(newTask);
  });

  it('normalizes a missing type to todo (pre-v1.4 / not-yet-merged backend responses)', () => {
    const bare = { id: 't1', title: 'Bare', completed: false, courses: [] } as ApiTask;
    hydrateTasks([bare]);
    expect(tasksById.get().t1.type).toBe('todo');
  });
});
