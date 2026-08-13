<script lang="ts">
  // /tasks route-modal body (rebuild of the old flat TaskList.svelte, now
  // deleted). One card per course (course-hued) + an always-last neutral
  // "Other" card, each with inline add + one level of subtasks. Filter chip
  // bar narrows the grid to a single card and syncs ?course= (slug, or
  // 'other') via history.replaceState — mirrors PlannerView's course filter.
  import TaskItem from './TaskItem.svelte';
  import TaskTypeIcon from './TaskTypeIcon.svelte';
  import {
    addTask,
    bucketByDue,
    deleteTask,
    hydrateTasks,
    selectChildren,
    selectForCourse,
    selectOpen,
    tasksList,
    toggleTask,
    type ApiTask,
  } from '../../lib/stores/tasks';
  import { TASK_TYPE_META } from '../../lib/taskTypeMeta';

  interface CourseOption {
    id: string;
    slug: string;
    code: string;
    title: string;
    hue: number;
  }

  interface Props {
    initialTasks: ApiTask[];
    courses: CourseOption[];
    initialCourseFilter: string | null;
  }

  let { initialTasks, courses, initialCourseFilter }: Props = $props();

  hydrateTasks(initialTasks);

  const courseHues: Record<string, number> = {};
  for (const c of courses) courseHues[c.id] = c.hue;

  let activeFilter = $state<string | null>(
    initialCourseFilter === 'other' || courses.some((c) => c.slug === initialCourseFilter) ? initialCourseFilter : null,
  );

  let visibleCourses = $derived(
    activeFilter === null ? courses : activeFilter === 'other' ? [] : courses.filter((c) => c.slug === activeFilter),
  );
  let showOther = $derived(activeFilter === null || activeFilter === 'other');

  function setFilter(next: string | null) {
    activeFilter = next;
    const url = new URL(window.location.href);
    if (next === null) url.searchParams.delete('course');
    else url.searchParams.set('course', next);
    history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
  }

  // ---- grouping/ordering ----------------------------------------------

  // A task's course membership can come from either the origin FK
  // (system-generated tasks) or a task_courses link row (user tasks) —
  // matches the store's selectForCourse check.
  function courseIdsOfTask(t: ApiTask): string[] {
    const ids = new Set<string>();
    if (t.course_id) ids.add(t.course_id);
    for (const c of t.courses) ids.add(c.id);
    return [...ids];
  }

  function weightOf(t: ApiTask): number {
    return TASK_TYPE_META[t.type ?? 'todo'].weight;
  }

  // bucketByDue already sorts each bucket by due date and owns the
  // attend_class/undated special-casing; this re-sort only adds the plan's
  // tie-break (dated asc -> undated by created_at -> TASK_TYPE_META.weight)
  // without moving a task between buckets.
  function compareOpen(a: ApiTask, b: ApiTask): number {
    const aUndated = !a.due_date;
    const bUndated = !b.due_date;
    if (aUndated !== bUndated) return aUndated ? 1 : -1;
    const primary = aUndated
      ? (a.created_at ?? '').localeCompare(b.created_at ?? '')
      : (a.due_date as string).localeCompare(b.due_date as string);
    return primary !== 0 ? primary : weightOf(a) - weightOf(b);
  }

  interface CardData {
    key: string;
    title: string;
    courseId?: string;
    hue?: number;
    open: ApiTask[];
    catchUp: ApiTask[];
    done: ApiTask[];
  }

  function buildCard(key: string, title: string, courseId: string | undefined, hue: number | undefined, tasks: ApiTask[]): CardData {
    const topLevel = tasks.filter((t) => !t.parent_task_id);
    const buckets = bucketByDue(selectOpen(topLevel));
    const open = [...buckets.overdue, ...buckets.today, ...buckets.next].sort(compareOpen);
    const catchUp = [...buckets.catchUp].sort(compareOpen);
    const done = topLevel
      .filter((t) => t.completed)
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
      .slice(0, 10);
    return { key, title, courseId, hue, open, catchUp, done };
  }

  let allTasks = $derived($tasksList);

  let cards = $derived.by(() => {
    const result: CardData[] = [];
    for (const c of visibleCourses) {
      result.push(buildCard(c.slug, c.code, c.id, c.hue, selectForCourse(allTasks, c.id)));
    }
    if (showOther) {
      const otherTasks = allTasks.filter((t) => courseIdsOfTask(t).length === 0);
      result.push(buildCard('other', 'Other', undefined, undefined, otherTasks));
    }
    return result;
  });

  // ---- subtask expand/collapse ----------------------------------------

  let expandedIds = $state<Set<string>>(new Set());
  function toggleExpanded(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }

  async function toggleParent(task: ApiTask) {
    // Cascade is a no-op when a task has no children, so this is safe to
    // use uniformly for every top-level row rendered with the chevron path.
    await toggleTask(task.id, { cascadeChildren: true });
  }

  async function removeTask(task: ApiTask) {
    if (!confirm('Delete this task?')) return;
    await deleteTask(task.id);
  }

  // ---- inline add (per card) -------------------------------------------

  let openAddFormKey = $state<string | null>(null);
  let addTitle = $state('');
  let addDate = $state('');
  let addBusy = $state(false);

  function openAddForm(key: string) {
    openAddFormKey = key;
    addTitle = '';
    addDate = '';
    (window as any).__tasksBlockEscape = true;
  }
  function closeAddForm() {
    openAddFormKey = null;
    syncBlockEscape();
  }

  // Local <input type=date> values are calendar days with no timezone of
  // their own; anchoring at local noon (not local midnight) means a later
  // reparse + setHours(0,0,0,0) in the browser's own timezone always lands
  // back on this same calendar day (mirrors the backend's UTC-noon
  // discipline for day-granular dates).
  function dateInputToIso(value: string): string | undefined {
    if (!value) return undefined;
    return new Date(`${value}T12:00:00`).toISOString();
  }

  async function submitAdd(courseId: string | undefined) {
    const title = addTitle.trim();
    if (!title) return;
    addBusy = true;
    try {
      await addTask({
        title,
        due_date: dateInputToIso(addDate),
        course_ids: courseId ? [courseId] : undefined,
      });
      closeAddForm();
    } finally {
      addBusy = false;
    }
  }

  // ---- inline add (subtask) --------------------------------------------

  let openSubtaskAddId = $state<string | null>(null);
  let subtaskTitle = $state('');
  let subtaskBusy = $state(false);

  function openSubtaskAdd(parentId: string) {
    openSubtaskAddId = parentId;
    subtaskTitle = '';
    (window as any).__tasksBlockEscape = true;
  }
  function closeSubtaskAdd() {
    openSubtaskAddId = null;
    syncBlockEscape();
  }
  function syncBlockEscape() {
    (window as any).__tasksBlockEscape = openAddFormKey !== null || openSubtaskAddId !== null;
  }

  async function submitSubtask(parent: ApiTask) {
    const title = subtaskTitle.trim();
    if (!title) return;
    subtaskBusy = true;
    try {
      await addTask({
        title,
        parent_task_id: parent.id,
        course_ids: courseIdsOfTask(parent),
      });
      closeSubtaskAdd();
      expandedIds = new Set(expandedIds).add(parent.id);
    } finally {
      subtaskBusy = false;
    }
  }

  function onFormKeydown(e: KeyboardEvent, close: () => void) {
    if (e.key !== 'Escape') return;
    // Stop the modal's own Escape listener (tasks.astro, guarded by the
    // same __tasksBlockEscape flag) from also seeing this keypress — a
    // first Escape should only close the form, not the whole modal.
    e.stopPropagation();
    close();
  }
</script>

{#snippet parentRow(task: ApiTask, children: ApiTask[])}
  {@const doneCount = children.filter((c) => c.completed).length}
  {@const expanded = expandedIds.has(task.id)}
  {@const allDone = doneCount === children.length}
  <div class="task-row" class:completed={task.completed}>
    <button
      type="button"
      class="chevron-btn"
      aria-expanded={expanded}
      aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'}
      onclick={() => toggleExpanded(task.id)}
    >
      <span class="chevron" class:open={expanded} aria-hidden="true">›</span>
    </button>
    <input
      type="checkbox"
      class="task-checkbox"
      checked={task.completed}
      onchange={() => toggleParent(task)}
      aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
    />
    <div class="task-info">
      {#if task.type && task.type !== 'todo'}
        <span class="task-type-icon" title={task.type}><TaskTypeIcon type={task.type} /></span>
      {/if}
      <span class="task-title">{task.title}</span>
    </div>
    <span class="pill" class:pill-ok={allDone && !task.completed} class:pill-idle={!(allDone && !task.completed)}>
      {doneCount}/{children.length}
    </span>
    <button type="button" class="btn-delete" onclick={() => removeTask(task)} title="Delete task">Delete</button>
  </div>
  {#if expanded}
    <div class="children">
      {#each children as child (child.id)}
        <TaskItem task={child} compact {courseHues} />
      {/each}
      {#if openSubtaskAddId === task.id}
        <form class="inline-add subtask-add" onsubmit={(e) => { e.preventDefault(); submitSubtask(task); }} onkeydown={(e) => onFormKeydown(e, closeSubtaskAdd)}>
          <input type="text" bind:value={subtaskTitle} placeholder="Subtask title" autofocus />
          <button type="submit" class="btn btn-secondary" disabled={!subtaskTitle.trim() || subtaskBusy}>Add</button>
        </form>
      {:else}
        <button type="button" class="ghost-add child-add" onclick={() => openSubtaskAdd(task.id)}>+ Add subtask</button>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="tasks-view">
  <div class="chip-row" role="group" aria-label="Filter by course">
    <button type="button" class="chip" aria-pressed={activeFilter === null} onclick={() => setFilter(null)}>All</button>
    {#each courses as c (c.id)}
      <button type="button" class="chip course-chip" aria-pressed={activeFilter === c.slug} onclick={() => setFilter(c.slug)}>
        <span class="dot" style={`--course-h:${c.hue}`}></span>{c.code}
      </button>
    {/each}
    <button type="button" class="chip" aria-pressed={activeFilter === 'other'} onclick={() => setFilter('other')}>Other</button>
  </div>

  {#if courses.length === 0}
    <p class="muted-hint">
      No courses yet.
      <button type="button" class="link-btn" onclick={() => window.dispatchEvent(new CustomEvent('open-add-course'))}>
        Add a course
      </button>
      to start organizing tasks by course.
    </p>
  {/if}

  <div class="card-grid">
    {#each cards as card (card.key)}
      <section class="card task-card" class:other-card={!card.courseId} style={card.hue !== undefined ? `--course-h:${card.hue}` : ''}>
        <div class="card-head">
          <h2 class="card-title">{card.title}</h2>
          <span class="open-count">{card.open.length + card.catchUp.length} open</span>
        </div>

        <div class="card-body">
          {#each card.open as task (task.id)}
            {@const kids = selectChildren(allTasks, task.id)}
            {#if kids.length > 0}
              {@render parentRow(task, kids)}
            {:else}
              <TaskItem {task} {courseHues} />
            {/if}
          {/each}

          {#if card.catchUp.length > 0}
            <div class="catch-up-cluster">
              <p class="kicker">Catch up</p>
              {#each card.catchUp as task (task.id)}
                {@const kids = selectChildren(allTasks, task.id)}
                {#if kids.length > 0}
                  {@render parentRow(task, kids)}
                {:else}
                  <TaskItem {task} {courseHues} />
                {/if}
              {/each}
            </div>
          {/if}

          {#if card.open.length === 0 && card.catchUp.length === 0 && card.done.length === 0}
            <p class="empty">Nothing here — add a task.</p>
          {/if}

          {#if card.done.length > 0}
            <details class="done-disclosure">
              <summary>Done ({card.done.length})</summary>
              <div class="done-list">
                {#each card.done as task (task.id)}
                  <TaskItem {task} compact {courseHues} />
                {/each}
              </div>
            </details>
          {/if}

          {#if openAddFormKey === card.key}
            <form class="inline-add" onsubmit={(e) => { e.preventDefault(); submitAdd(card.courseId); }} onkeydown={(e) => onFormKeydown(e, closeAddForm)}>
              <input type="text" bind:value={addTitle} placeholder="Task title" autofocus />
              <input type="date" bind:value={addDate} aria-label="Due date" />
              <button type="submit" class="btn btn-primary" disabled={!addTitle.trim() || addBusy}>Add</button>
            </form>
          {:else}
            <button type="button" class="ghost-add" onclick={() => openAddForm(card.key)}>+ Add task</button>
          {/if}
        </div>
      </section>
    {/each}
  </div>
</div>

<style>
  .tasks-view {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .course-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--course);
    flex-shrink: 0;
  }

  .muted-hint {
    color: var(--muted);
    font-size: 13px;
  }

  .link-btn {
    background: none;
    color: var(--accent);
    font-weight: 600;
    text-decoration: underline;
  }

  /* Fixed overlay layer (the modal panel, not AppShell's <main>), so page
     breakpoints here use plain @media rather than a container query — the
     PlannerView-documented exception to the repo's @container convention
     (PlannerView.svelte's .planner-body follows the same rule). */
  .card-grid {
    display: grid;
    /* 380px min, not 320: a non-compact TaskItem row carries ~250px of fixed
       chrome (checkbox, type icon, hue dot, due pill, Delete, gaps, padding),
       so a 320px track leaves titles ~70px before ellipsis. 380 keeps three
       columns at 1440 with ~180px of readable title. */
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    gap: 18px;
    align-items: start;
  }
  @media (max-width: 900px) {
    .card-grid {
      grid-template-columns: 1fr;
    }
  }

  .task-card {
    border-top: 3px solid var(--course);
  }
  .task-card.other-card {
    border-top-color: var(--border);
  }

  .open-count {
    font-size: 12px;
    color: var(--muted);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* Parent-with-children row: TaskItem can't cascade (frozen contract), so
     this mirrors its non-compact visual language directly. */
  .task-row {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 8px);
  }
  .task-row.completed {
    opacity: 0.7;
  }
  .chevron-btn {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    margin-top: 2px;
    color: var(--muted);
  }
  .chevron {
    display: inline-block;
    font-size: 15px;
    line-height: 1;
    transition: transform var(--motion-base) var(--ease);
  }
  .chevron.open {
    transform: rotate(90deg);
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
  .task-row.completed .task-title {
    text-decoration: line-through;
    color: var(--muted);
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

  /* Subtasks: indented under the expanded parent with a hairline rule,
     per the plan's one-level-of-subtasks rule (children never nest). */
  .children {
    margin-left: 26px;
    padding-left: 12px;
    border-left: 2px solid var(--hairline);
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
  }

  .catch-up-cluster {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }
  .catch-up-cluster .kicker {
    margin-bottom: 0;
  }

  .done-disclosure {
    margin-top: 6px;
    border-top: 1px solid var(--hairline);
    padding-top: 8px;
  }
  .done-disclosure summary {
    cursor: pointer;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .done-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 6px;
  }

  .ghost-add {
    text-align: left;
    color: var(--muted);
    font-size: 13px;
    padding: 8px 10px;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    background: none;
  }
  .ghost-add:hover {
    border-color: var(--muted);
    color: var(--text);
  }
  .ghost-add.child-add {
    margin-top: 2px;
    padding: 6px 8px;
    font-size: 12.5px;
  }

  .inline-add {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .inline-add input[type='text'] {
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .inline-add input[type='date'] {
    padding: 7px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .inline-add.subtask-add {
    margin-top: 4px;
  }
</style>
