<script lang="ts">
  // Single task row, shared by TodayTasks, TasksView (per-course cards +
  // subtasks), the course TasksCard, and TodoDropdown's compact panel.
  // Store-backed: the checkbox and delete button delegate to the tasks
  // store's toggleTask/deleteTask (optimistic, store-owned rollback +
  // tasksError on failure), then still bubble via ontoggle/ondelete — the
  // public contract is frozen so callers with their own non-store list state
  // (or a side-effect hook to run) keep working unchanged.
  import TaskCheckbox from './TaskCheckbox.svelte';
  import TaskTypeIcon from './TaskTypeIcon.svelte';
  import CompletionFlow from './CompletionFlow.svelte';
  import { daysUntil, taskDueMeta } from '../../lib/plannerDates';
  import { deleteTask, snoozeTask, tasksById, toggleTask, type ApiTask } from '../../lib/stores/tasks';
  import { TASK_TYPE_META, type TaskType } from '../../lib/taskTypeMeta';

  export interface TaskItemTask {
    id: string;
    title: string;
    description?: string | null;
    completed: boolean;
    due_date?: string | null;
    type?: TaskType;
    source?: 'user' | 'system';
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
  // Mounted only while checking (not unchecking) a typed task — the flow
  // owns collecting recap/follow-ups and completing it; see handleCheck.
  let flowOpen = $state(false);

  function dueMeta(t: TaskItemTask) {
    if (!t.due_date) return null;
    return taskDueMeta(daysUntil(t.due_date), t.type === 'attend_class');
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

  // TaskCheckbox's onToggle fires on both check and uncheck; only checking
  // (task.completed is still false here) a typed task detours through
  // CompletionFlow instead of completing right away — a todo's reward is
  // the instant confetti moment, so it (and every uncheck) stays instant.
  function handleCheck() {
    if (!task.completed && task.type && task.type !== 'todo') {
      flowOpen = true;
      return;
    }
    void toggle();
  }

  // The flow already called toggleTask (+ any follow-ups) itself by the
  // time this fires — just close the dialog and bubble the same way toggle()
  // does for every other completion path.
  function handleFlowCompleted() {
    flowOpen = false;
    const current = tasksById.get()[task.id];
    if (current) ontoggle?.(current as ApiTask);
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

  async function snooze() {
    busy = true;
    try {
      await snoozeTask(task.id);
    } finally {
      busy = false;
    }
  }

  let canSnooze = $derived(!compact && task.source === 'system' && !!task.due_date && !task.completed);
</script>

<div class="task-item" class:compact class:completed={task.completed}>
  <span class="task-checkbox-slot">
    <TaskCheckbox
      checked={task.completed}
      busy={busy || flowOpen}
      label={task.completed ? 'Mark incomplete' : 'Mark complete'}
      onToggle={handleCheck}
    />
  </span>
  <div class="task-info">
    <div class="task-title-row">
      {#if task.type && task.type !== 'todo'}
        <span class="task-type-icon" title={TASK_TYPE_META[task.type]?.label ?? task.type}><TaskTypeIcon type={task.type} /></span>
      {/if}
      <span class="task-title">{task.title}</span>
    </div>
    {#if task.description}
      <span class="task-desc">{task.description}</span>
    {/if}
    <!-- Badges/pills live on their own wrapping line, never the title's —
         the title row (above) is icon+title only so nothing here can ever
         crush it down to a sliver, regardless of how many badges a system
         task accumulates or how narrow the card column is. -->
    {#if task.source === 'system' || task.courses.length > 0 || due}
      <div class="task-meta-row">
        {#if task.source === 'system'}
          <span class="pill pill-idle auto-chip" title="Generated automatically">auto</span>
        {/if}
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
        {#if due}
          <span class="pill" class:pill-danger={due.danger} class:pill-idle={!due.danger}>{due.label}</span>
        {/if}
      </div>
    {/if}
  </div>
  {#if !compact}
    <div class="task-actions">
      {#if canSnooze}
        <button type="button" class="btn-snooze" onclick={snooze} title="Push due date to tomorrow" disabled={busy || flowOpen}>Not today</button>
      {/if}
      <button type="button" class="btn-delete" onclick={del} title="Delete task" disabled={busy || flowOpen}>Delete</button>
    </div>
  {/if}
</div>

{#if flowOpen}
  <CompletionFlow task={task as ApiTask} onClose={() => (flowOpen = false)} onCompleted={handleFlowCompleted} />
{/if}

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

  /* Wraps TaskCheckbox (its own internals aren't ours to target) so this
     row's geometry — margin, cursor, shrink behavior, mobile scale bump
     below — stays exactly what it was on the raw <input> this replaced. */
  .task-checkbox-slot {
    display: inline-flex;
    margin-top: 0.2rem;
    cursor: pointer;
    flex-shrink: 0;
  }

  .task-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .task-title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
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
    /* Two-line clamp, not single-line ellipsis: in narrow masonry columns
       the inline actions squeeze this line, and nowrap turned every
       generated title into "Attend CHEE…". Two lines keep rows scannable
       without letting long titles run away. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  /* Wraps freely (never truncates) — these are small discrete badges, not
     prose, so letting them spill onto another line costs a bit of row
     height instead of costing the title its readability. */
  .task-meta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .auto-chip {
    flex-shrink: 0;
  }

  .task-desc {
    font-size: 12px;
    color: var(--muted);
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

  .task-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .btn-delete,
  .btn-snooze {
    background: none;
    color: var(--muted);
    font-size: 0.8rem;
    padding: 0.3rem 0.4rem;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .btn-snooze:hover {
    color: var(--accent-ink, var(--accent));
  }

  .btn-delete:hover {
    color: var(--danger-ink, var(--danger));
  }

  /* TaskItem renders inside main in every consumer (TodayTasks, TasksCard,
     TodoDropdown, and now TasksView too) — @media (not @container) is
     deliberate here regardless, since this is a viewport-keyed touch-
     ergonomics bump (bigger tap targets), not a layout reflow. Public
     contract (props, classes, markup) is untouched. */
  @media (max-width: 767px) {
    .task-item:not(.compact) {
      padding: 0.85rem 0.75rem;
      /* Actions drop to their own line below (flex-basis:100% on
         .task-actions forces it, regardless of how much space is left) —
         the 44px touch targets just below make Not-today/Delete wider
         than they are on desktop, and phone card widths are exactly the
         narrow end this component has to hold up at, so keeping them on
         the title's row here would reopen the same crush. */
      flex-wrap: wrap;
    }
    .task-checkbox-slot {
      transform: scale(1.25);
    }
    .task-actions {
      flex: 0 0 100%;
      justify-content: flex-end;
      margin-top: 4px;
    }
    .btn-delete,
    .btn-snooze {
      min-height: 44px;
      padding: 0.65rem 0.5rem;
      display: inline-flex;
      align-items: center;
    }
  }
</style>
