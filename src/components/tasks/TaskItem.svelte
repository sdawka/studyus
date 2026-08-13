<script lang="ts">
  // Single task row, extracted so TaskList's 4 sections and TodoDropdown's
  // compact panel share one implementation. Store-backed: the checkbox and
  // delete button delegate to the tasks store's toggleTask/deleteTask
  // (optimistic, store-owned rollback + tasksError on failure), then still
  // bubble via ontoggle/ondelete — the public contract is frozen so callers
  // with their own non-store list state (or a side-effect hook to run) keep
  // working unchanged.
  import TaskTypeIcon from './TaskTypeIcon.svelte';
  import { deleteTask, tasksById, toggleTask, type ApiTask } from '../../lib/stores/tasks';
  import type { TaskType } from '../../lib/taskTypeMeta';

  export interface TaskItemTask {
    id: string;
    title: string;
    completed: boolean;
    due_date?: string | null;
    type?: TaskType;
    parent_task_id?: string | null;
    completed_at?: string | null;
    courses: Array<{ id: string; code: string }>;
  }

  interface Props {
    task: TaskItemTask;
    compact?: boolean;
    courseHues?: Record<string, number>;
    ontoggle?: (task: TaskItemTask) => void;
    ondelete?: (taskId: string) => void;
  }

  let { task, compact = false, courseHues = {}, ontoggle, ondelete }: Props = $props();
  let busy = $state(false);

  function dueMeta(t: TaskItemTask) {
    if (!t.due_date) return null;
    const due = new Date(t.due_date);
    due.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const days = Math.round((due.getTime() - now.getTime()) / 86_400_000);
    if (days < 0) {
      // A past-due attend_class task means a class was missed — that's
      // catch-up work, not a broken commitment. Never the red overdue pill.
      if (t.type === 'attend_class') return { label: 'catch up', danger: false };
      return { label: 'overdue', danger: true };
    }
    if (days === 0) return { label: 'Today', danger: false };
    if (days === 1) return { label: 'Tomorrow', danger: false };
    return { label: `in ${days}d`, danger: false };
  }

  let due = $derived(dueMeta(task));

  async function toggle() {
    busy = true;
    try {
      await toggleTask(task.id);
      const current = tasksById.get()[task.id];
      if (current) ontoggle?.(current as ApiTask);
    } finally {
      busy = false;
    }
  }

  async function del() {
    if (!confirm('Delete this task?')) return;
    busy = true;
    try {
      await deleteTask(task.id);
      if (!(task.id in tasksById.get())) ondelete?.(task.id);
    } finally {
      busy = false;
    }
  }
</script>

<div class="task-item" class:compact class:completed={task.completed}>
  <input
    type="checkbox"
    class="task-checkbox"
    checked={task.completed}
    disabled={busy}
    onchange={toggle}
    aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
  />
  <div class="task-info">
    {#if task.type && task.type !== 'todo'}
      <span class="task-type-icon" title={task.type}><TaskTypeIcon type={task.type} /></span>
    {/if}
    <span class="task-title">{task.title}</span>
    {#if task.courses.length > 0}
      <span class="course-dots">
        {#each task.courses as c (c.id)}
          <span
            class="dot"
            class:neutral={courseHues[c.id] === undefined}
            style={courseHues[c.id] !== undefined ? `--course-h:${courseHues[c.id]}` : ''}
            title={c.code}
          ></span>
        {/each}
      </span>
    {/if}
  </div>
  {#if due}
    <span class="pill" class:pill-danger={due.danger} class:pill-idle={!due.danger}>{due.label}</span>
  {/if}
  {#if !compact}
    <button type="button" class="btn-delete" onclick={del} title="Delete task" disabled={busy}>Delete</button>
  {/if}
</div>

<style>
  .task-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
    transition: all 0.15s;
  }

  .task-item:hover {
    border-color: var(--muted);
  }

  .task-item.compact {
    padding: 0.4rem 0.5rem;
    border: none;
    border-radius: var(--radius-sm, 6px);
    gap: 0.5rem;
  }

  .task-item.compact:hover {
    background: var(--hover);
  }

  .task-item.completed {
    opacity: 0.7;
  }

  .task-checkbox {
    margin-top: 0.2rem;
    cursor: pointer;
    flex-shrink: 0;
  }

  .task-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }

  .task-type-icon {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--muted);
  }

  .task-title {
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-item.completed .task-title {
    text-decoration: line-through;
    color: var(--muted);
  }

  .course-dots {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--course, var(--muted));
  }

  .dot.neutral {
    background: var(--muted);
  }

  .btn-delete {
    background: none;
    color: var(--muted);
    font-size: 0.8rem;
    padding: 0.3rem 0.4rem;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .btn-delete:hover {
    color: var(--danger-ink, var(--danger));
  }
</style>
