// Central task store (v1.4 task-centric platform): every task-consuming
// island (TodoDropdown today; TasksView/TasksCard/TodayTasks in Phase 2)
// reads and writes through here instead of doing its own fetch, so an
// optimistic toggle/delete in one island is instantly visible in any other
// island mounted on the same page. Convention of ui.ts/courseContext.ts:
// tiny, framework-agnostic, SSR-safe — module-level code only creates
// atoms, never touches fetch/window.
//
// Builds against the frozen wire contract in docs/api.md's "v1.4
// Additions" section ahead of the backend tracks merging; `type` (and the
// other new fields) may be entirely absent from a response until then, so
// every task is normalized to default `type: 'todo'` on the way in.
import { atom, computed, map } from 'nanostores';
import type { TaskType } from '../taskTypeMeta';

export interface ApiTaskCourse {
  id: string;
  code: string;
}

export interface ApiTask {
  id: string;
  title: string;
  description?: string | null;
  type?: TaskType;
  due_date?: string | null;
  completed: boolean;
  completed_at?: string | null;
  parent_task_id?: string | null;
  course_id?: string | null;
  class_session_id?: string | null;
  assessment_id?: string | null;
  kc_id?: string | null;
  source?: 'user' | 'system';
  created_at?: string;
  courses: ApiTaskCourse[];
}

export type TasksStatus = 'idle' | 'loading' | 'ready' | 'error';

export const tasksById = map<Record<string, ApiTask>>({});
export const tasksStatus = atom<TasksStatus>('idle');
export const tasksError = atom<string | null>(null);

export const tasksList = computed(tasksById, (byId) => Object.values(byId));

function normalize(task: ApiTask): ApiTask {
  return task.type ? task : { ...task, type: 'todo' };
}

// The frozen API envelope (src/lib/api.ts): { data } on success,
// { error: { code, message } } on failure.
interface ApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

// `Response#json()` rejects on a non-JSON body; a request that never made
// it to a route handler (offline, backend redeploying) can do that.
async function parseJson<T>(res: Response): Promise<ApiEnvelope<T> | null> {
  try {
    return (await res.json()) as ApiEnvelope<T>;
  } catch {
    return null;
  }
}

function errorMessage(json: ApiEnvelope<unknown> | null, fallback: string): string {
  return json?.error?.message ?? fallback;
}

// First-hydrator-wins: once the store is 'ready', a later hydrator (e.g. a
// second island seeded from the same page's server-rendered props) only
// fills in ids it doesn't already know about — it never overwrites
// something the store (or a user action) already has. Astro is MPA, so
// this reconciliation only ever matters within one page's island tree.
export function hydrateTasks(initial: ApiTask[]): void {
  if (tasksStatus.get() === 'ready') {
    const byId = tasksById.get();
    for (const task of initial) {
      if (!(task.id in byId)) tasksById.setKey(task.id, normalize(task));
    }
    return;
  }
  const byId: Record<string, ApiTask> = {};
  for (const task of initial) byId[task.id] = normalize(task);
  tasksById.set(byId);
  tasksStatus.set('ready');
  tasksError.set(null);
}

let loadPromise: Promise<void> | null = null;

// Full replace from GET /api/v1/tasks. Concurrent callers (this module's own
// dedupe, see ensureLoaded) share the in-flight promise rather than issuing
// parallel fetches.
export function refetchTasks(): Promise<void> {
  if (loadPromise) return loadPromise;
  tasksStatus.set('loading');
  loadPromise = (async () => {
    try {
      const res = await fetch('/api/v1/tasks');
      const json = await parseJson<ApiTask[]>(res);
      if (!res.ok) {
        tasksError.set(errorMessage(json, 'Failed to load tasks'));
        tasksStatus.set('error');
        return;
      }
      const byId: Record<string, ApiTask> = {};
      for (const task of json?.data ?? []) byId[task.id] = normalize(task);
      tasksById.set(byId);
      tasksStatus.set('ready');
      tasksError.set(null);
    } catch {
      tasksError.set('Failed to load tasks');
      tasksStatus.set('error');
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

// Idle (never loaded) or a previously failed load → GET once. Already
// ready → no-op. Already loading → piggyback on the in-flight promise.
// Callers: TodoDropdown on open, TasksCard on mount.
export function ensureLoaded(): Promise<void> {
  const status = tasksStatus.get();
  if (status === 'idle' || status === 'error') return refetchTasks();
  return loadPromise ?? Promise.resolve();
}

export interface AddTaskInput {
  title: string;
  due_date?: string | null;
  course_ids?: string[];
  parent_task_id?: string;
}

// Not optimistic — no temp-id dance. Awaits the POST and inserts the real
// response row.
export async function addTask(input: AddTaskInput): Promise<ApiTask> {
  const res = await fetch('/api/v1/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await parseJson<ApiTask>(res);
  if (!res.ok || !json?.data) {
    const message = errorMessage(json, 'Failed to add task');
    tasksError.set(message);
    throw new Error(message);
  }
  const task = normalize(json.data);
  tasksById.setKey(task.id, task);
  tasksError.set(null);
  return task;
}

async function patchTask(id: string, body: Record<string, unknown>): Promise<ApiTask> {
  const res = await fetch(`/api/v1/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await parseJson<ApiTask>(res);
  if (!res.ok || !json?.data) throw new Error(errorMessage(json, 'Failed to update task'));
  return normalize(json.data);
}

export interface ToggleTaskOptions {
  cascadeChildren?: boolean;
}

// Optimistic flip (+ open children when cascading), then PATCH. Any
// failure — parent or a cascaded child — rolls the whole map back to the
// pre-toggle snapshot and surfaces the message on tasksError.
export async function toggleTask(id: string, options: ToggleTaskOptions = {}): Promise<void> {
  const snapshot = tasksById.get();
  const task = snapshot[id];
  if (!task) return;

  const completed = !task.completed;
  const completedAt = completed ? new Date().toISOString() : null;
  tasksById.setKey(id, { ...task, completed, completed_at: completedAt });

  const cascadeIds: string[] = [];
  if (options.cascadeChildren && completed) {
    for (const child of selectChildren(Object.values(snapshot), id)) {
      if (!child.completed) {
        cascadeIds.push(child.id);
        tasksById.setKey(child.id, { ...child, completed: true, completed_at: completedAt });
      }
    }
  }

  try {
    const patched = await patchTask(id, { completed });
    tasksById.setKey(id, patched);
    // Sequential by design (plan: "PATCH loop for cascade") — cascade sets
    // are small (one level of subtasks) and this keeps failure handling to
    // a single rollback path below.
    for (const childId of cascadeIds) {
      const childPatched = await patchTask(childId, { completed: true });
      tasksById.setKey(childId, childPatched);
    }
    tasksError.set(null);
  } catch (err) {
    tasksById.set(snapshot);
    tasksError.set(err instanceof Error ? err.message : 'Failed to update task');
  }
}

// Optimistic remove (+ children), rollback to the pre-delete snapshot on
// failure.
export async function deleteTask(id: string): Promise<void> {
  const snapshot = tasksById.get();
  const children = selectChildren(Object.values(snapshot), id);

  const next = { ...snapshot };
  delete next[id];
  for (const child of children) delete next[child.id];
  tasksById.set(next);

  try {
    const res = await fetch(`/api/v1/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = await parseJson<unknown>(res);
      throw new Error(errorMessage(json, 'Failed to delete task'));
    }
    tasksError.set(null);
  } catch (err) {
    tasksById.set(snapshot);
    tasksError.set(err instanceof Error ? err.message : 'Failed to delete task');
  }
}

// ---------------------------------------------------------------------------
// Selectors — plain functions (no store reads inside), safe to call from
// $derived and unit-testable without a DOM.
// ---------------------------------------------------------------------------

export function selectOpen(tasks: ApiTask[]): ApiTask[] {
  return tasks.filter((t) => !t.completed);
}

export function selectForCourse(tasks: ApiTask[], courseId: string): ApiTask[] {
  return tasks.filter((t) => t.course_id === courseId || t.courses.some((c) => c.id === courseId));
}

export function selectChildren(tasks: ApiTask[], parentId: string): ApiTask[] {
  return tasks.filter((t) => t.parent_task_id === parentId);
}

export interface DueBuckets {
  overdue: ApiTask[];
  today: ApiTask[];
  next: ApiTask[];
  catchUp: ApiTask[];
}

function startOfDay(d: Date): number {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function byDueDateAsc(a: ApiTask, b: ApiTask): number {
  // due_date is an ISO string (toApi) — lexicographic order matches
  // chronological order, no need to parse.
  return (a.due_date ?? '').localeCompare(b.due_date ?? '');
}

// Owns attend_class special-casing in ONE place: a past-due attend_class
// task never counts as overdue (missing a class isn't a broken commitment
// the way a missed assignment is) — it sinks to `catchUp` instead.
// Undated tasks (stale_kc's "anytime" policy) have nothing to be overdue
// against, so they land as a tail appended to `next`, sorted after every
// dated entry there.
export function bucketByDue(tasks: ApiTask[], now: Date = new Date()): DueBuckets {
  const todayStart = startOfDay(now);
  const overdue: ApiTask[] = [];
  const today: ApiTask[] = [];
  const next: ApiTask[] = [];
  const undated: ApiTask[] = [];
  const catchUp: ApiTask[] = [];

  for (const task of tasks) {
    if (!task.due_date) {
      undated.push(task);
      continue;
    }
    const dueStart = startOfDay(new Date(task.due_date));
    if (dueStart < todayStart) {
      if (task.type === 'attend_class') catchUp.push(task);
      else overdue.push(task);
    } else if (dueStart === todayStart) {
      today.push(task);
    } else {
      next.push(task);
    }
  }

  overdue.sort(byDueDateAsc);
  today.sort(byDueDateAsc);
  next.sort(byDueDateAsc);
  catchUp.sort(byDueDateAsc);

  return { overdue, today, next: [...next, ...undated], catchUp };
}
