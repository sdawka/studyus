<script lang="ts">
  // Single task row, extracted so TaskList's 4 sections and TodoDropdown's
  // compact panel share one implementation. Self-contained: the checkbox and
  // delete button each do their own PATCH/DELETE, then notify the parent via
  // ontoggle/ondelete so it can keep its own list in sync (no refetch needed).
  export interface TaskItemTask {
    id: string;
    title: string;
    completed: boolean;
    due_date?: string | null;
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

  function dueMeta(dueDate?: string | null) {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const days = Math.round((due.getTime() - now.getTime()) / 86_400_000);
    if (days < 0) return { label: 'overdue', danger: true };
    if (days === 0) return { label: 'Today', danger: false };
    if (days === 1) return { label: 'Tomorrow', danger: false };
    return { label: `in ${days}d`, danger: false };
  }

  let due = $derived(dueMeta(task.due_date));

  async function toggle() {
    busy = true;
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !task.completed }),
      });
      if (res.ok) {
        const json = await res.json();
        ontoggle?.(json.data);
      }
    } finally {
      busy = false;
    }
  }

  async function del() {
    if (!confirm('Delete this task?')) return;
    busy = true;
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}`, { method: 'DELETE' });
      if (res.ok) ondelete?.(task.id);
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
