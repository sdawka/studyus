<script lang="ts">
  // /tasks page body (full page — tasks.astro renders this directly into
  // AppShell's default slot, not a route-modal overlay). Two tabs: Open
  // (one card per course, course-hued, + an always-last neutral "Other"
  // card, each with inline add + one level of subtasks) and Ta-Da
  // (selectCompleted(), grouped by day — a trophy shelf, not a graveyard).
  // Both tabs render into the same CSS-grid masonry (src/lib/actions/
  // masonry.ts) so short cards don't leave gaps. The course filter chips
  // (Open tab only) are multi-select and sync ?course=slug1,slug2 (comma
  // list) via history.replaceState; the active tab syncs ?tab=tada the
  // same way. tasks.astro parses both server-side for the first paint.
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import TaskItem from './TaskItem.svelte';
  import TaskTypeIcon from './TaskTypeIcon.svelte';
  import { masonryItem } from '../../lib/actions/masonry';
  import {
    addTask,
    bucketByDue,
    deleteTask,
    hydrateTasks,
    recentlyCompletedIds,
    selectChildren,
    selectCompleted,
    selectForCourse,
    selectOpen,
    snoozeTask,
    tasksList,
    toggleTask,
    type ApiTask,
  } from '../../lib/stores/tasks';
  import { TASK_TYPE_META } from '../../lib/taskTypeMeta';
  import { addDays, formatWeekdayAndDate, isSameLocalDay, localDateKeyFromIso } from '../../lib/plannerDates';

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
    initialCourseFilters: string[];
    initialTab: 'open' | 'tada';
  }

  let { initialTasks, courses, initialCourseFilters, initialTab }: Props = $props();

  hydrateTasks(initialTasks);

  const courseHues: Record<string, number> = {};
  for (const c of courses) courseHues[c.id] = c.hue;

  const validSlugs = new Set(['other', ...courses.map((c) => c.slug)]);

  // ---- tab -------------------------------------------------------------

  let activeTab = $state<'open' | 'tada'>(initialTab);

  function setTab(tab: 'open' | 'tada') {
    activeTab = tab;
    const url = new URL(window.location.href);
    if (tab === 'open') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
  }

  // ---- course filter (multi-select, Open tab only) ----------------------

  let activeFilters = $state<Set<string>>(new Set(initialCourseFilters.filter((s) => validSlugs.has(s))));

  let visibleCourses = $derived(
    activeFilters.size === 0 ? courses : courses.filter((c) => activeFilters.has(c.slug)),
  );
  let showOther = $derived(activeFilters.size === 0 || activeFilters.has('other'));

  function syncFilterUrl() {
    const url = new URL(window.location.href);
    if (activeFilters.size === 0) url.searchParams.delete('course');
    else url.searchParams.set('course', [...activeFilters].join(','));
    history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
  }

  function toggleFilter(slug: string) {
    const next = new Set(activeFilters);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    activeFilters = next;
    syncFilterUrl();
  }

  function clearFilters() {
    activeFilters = new Set();
    syncFilterUrl();
  }

  // ---- grouping/ordering (Open tab) --------------------------------------

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
    code: string;
    title?: string;
    courseId?: string;
    hue?: number;
    open: ApiTask[];
    catchUp: ApiTask[];
    done: ApiTask[];
  }

  function buildCard(
    key: string,
    code: string,
    title: string | undefined,
    courseId: string | undefined,
    hue: number | undefined,
    tasks: ApiTask[],
    graceIds: ReadonlySet<string>,
  ): CardData {
    const topLevel = tasks.filter((t) => !t.parent_task_id);
    const graceHeld = (t: ApiTask) => t.completed && graceIds.has(t.id);
    // selectOpen only wants `completed: false` — a grace-held task is
    // completed, so it's passed through with that flag faked off just for
    // this classification pass; the real task object (still genuinely
    // completed) is what actually lands in `open` and renders.
    const openTopLevel = topLevel.filter((t) => !t.completed || graceHeld(t)).map((t) => (graceHeld(t) ? { ...t, completed: false } : t));
    const buckets = bucketByDue(selectOpen(openTopLevel));
    const byId = new Map(topLevel.map((t) => [t.id, t]));
    const toReal = (t: ApiTask) => byId.get(t.id) ?? t;
    const open = [...buckets.overdue, ...buckets.today, ...buckets.next].map(toReal).sort(compareOpen);
    const catchUp = buckets.catchUp.map(toReal).sort(compareOpen);
    const done = topLevel
      .filter((t) => t.completed && !graceHeld(t))
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
      .slice(0, 10);
    return { key, code, title, courseId, hue, open, catchUp, done };
  }

  let allTasks = $derived($tasksList);
  let totalOpen = $derived(selectOpen(allTasks).length);

  // A task completing normally jumps straight from the `open` bucket into
  // `done` (rendered inside a separate, collapsed <details> further down) —
  // two different {#each} blocks, which Svelte can only implement as
  // destroy-then-recreate, never an in-place update. TaskCheckbox's
  // celebration guard (its own $effect comparing checked against the PRIOR
  // value) needs that in-place update to see the false→true edge; a fresh
  // instance mounts already-checked, indistinguishable from a page load
  // showing a task that was already done, so it correctly stays silent —
  // which silently ate the confetti reward for every ordinary completion on
  // this page. recentlyCompletedIds (stores/tasks.ts) is set synchronously
  // inside toggleTask itself, in the same tick as the optimistic flip — a
  // reaction here (e.g. a $effect watching allTasks) would run one render
  // too late, after the reclassifying re-render had already destroyed the
  // original instance. Reading the store's value directly like this keeps
  // buildCard's `open` classification correct from the very first render
  // that shows the task as completed.
  let graceIds = $derived($recentlyCompletedIds);

  let cards = $derived.by(() => {
    const result: CardData[] = [];
    for (const c of visibleCourses) {
      result.push(buildCard(c.slug, c.code, c.title, c.id, c.hue, selectForCourse(allTasks, c.id), graceIds));
    }
    if (showOther) {
      const otherTasks = allTasks.filter((t) => courseIdsOfTask(t).length === 0);
      result.push(buildCard('other', 'Other', undefined, undefined, undefined, otherTasks, graceIds));
    }
    return result;
  });

  // ---- Ta-Da tab: completed tasks grouped by local calendar day ---------

  interface DayGroup {
    key: string;
    label: string;
    tasks: ApiTask[];
  }

  function dayLabel(d: Date, now: Date, yesterday: Date): string {
    if (isSameLocalDay(d, now)) return 'Today';
    if (isSameLocalDay(d, yesterday)) return 'Yesterday';
    const { weekday, date } = formatWeekdayAndDate(d);
    return `${weekday} ${date}`;
  }

  // selectCompleted() is already sorted completed_at desc, so the first
  // task seen for a given calendar day fixes that day's position in
  // `order` — day groups come out most-recent-first for free.
  let tadaGroups = $derived.by(() => {
    const now = new Date();
    const yesterday = addDays(now, -1);
    const order: string[] = [];
    const byKey = new Map<string, DayGroup>();
    for (const t of selectCompleted(allTasks)) {
      if (!t.completed_at) continue;
      const key = localDateKeyFromIso(t.completed_at);
      let group = byKey.get(key);
      if (!group) {
        group = { key, label: dayLabel(new Date(t.completed_at), now, yesterday), tasks: [] };
        byKey.set(key, group);
        order.push(key);
      }
      group.tasks.push(t);
    }
    return order.map((key) => byKey.get(key)!);
  });

  function completionTimeLabel(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(' ', '');
  }

  function primaryHue(t: ApiTask): number | undefined {
    const ids = courseIdsOfTask(t);
    return ids.length > 0 ? courseHues[ids[0]] : undefined;
  }

  // ---- subtask expand/collapse ------------------------------------------

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

  async function snoozeParent(task: ApiTask) {
    await snoozeTask(task.id);
  }

  // ---- inline add (per card) ---------------------------------------------

  let openAddFormKey = $state<string | null>(null);
  let addTitle = $state('');
  let addDate = $state('');
  let addBusy = $state(false);

  function openAddForm(key: string) {
    openAddFormKey = key;
    addTitle = '';
    addDate = '';
  }
  function closeAddForm() {
    openAddFormKey = null;
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

  // ---- inline add (subtask) ----------------------------------------------

  let openSubtaskAddId = $state<string | null>(null);
  let subtaskTitle = $state('');
  let subtaskBusy = $state(false);

  function openSubtaskAdd(parentId: string) {
    openSubtaskAddId = parentId;
    subtaskTitle = '';
  }
  function closeSubtaskAdd() {
    openSubtaskAddId = null;
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
    if (e.key === 'Escape') close();
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
      <div class="task-title-row">
        {#if task.type && task.type !== 'todo'}
          <span class="task-type-icon" title={TASK_TYPE_META[task.type]?.label ?? task.type}><TaskTypeIcon type={task.type} /></span>
        {/if}
        <span class="task-title">{task.title}</span>
      </div>
      {#if task.description}
        <span class="task-desc">{task.description}</span>
      {/if}
      <!-- Badges/pills on their own wrapping line, never the title's row —
           same reasoning as TaskItem.svelte's task-meta-row: this row
           already carries a chevron + checkbox + (up to) two action
           buttons, so the title can't afford to also share its line with
           an auto chip and the n/m subtask-progress pill. -->
      <div class="task-meta-row">
        {#if task.source === 'system'}
          <span class="pill pill-idle auto-chip" title="Generated automatically">auto</span>
        {/if}
        <span class="pill" class:pill-ok={allDone && !task.completed} class:pill-idle={!(allDone && !task.completed)}>
          {doneCount}/{children.length}
        </span>
      </div>
    </div>
    <div class="task-actions">
      {#if task.source === 'system' && task.due_date && !task.completed}
        <button type="button" class="btn-snooze" onclick={() => snoozeParent(task)} title="Push due date to tomorrow">Not today</button>
      {/if}
      <button type="button" class="btn-delete" onclick={() => removeTask(task)} title="Delete task">Delete</button>
    </div>
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
  <div class="page-head">
    <h1>Tasks</h1>
    <span class="pill pill-idle open-total">{totalOpen} open</span>
  </div>

  <div class="tab-strip" role="group" aria-label="Tasks view">
    <button type="button" aria-selected={activeTab === 'open'} onclick={() => setTab('open')}>Open</button>
    <button type="button" aria-selected={activeTab === 'tada'} onclick={() => setTab('tada')}>Ta-Da</button>
  </div>

  {#if activeTab === 'open'}
    <div class="chip-row" role="group" aria-label="Filter by course">
      <button type="button" class="chip" aria-pressed={activeFilters.size === 0} onclick={clearFilters}>All</button>
      {#each courses as c (c.id)}
        <button type="button" class="chip course-chip" aria-pressed={activeFilters.has(c.slug)} onclick={() => toggleFilter(c.slug)}>
          <span class="dot" style={`--course-h:${c.hue}`}></span>{c.code}
        </button>
      {/each}
      <button type="button" class="chip" aria-pressed={activeFilters.has('other')} onclick={() => toggleFilter('other')}>Other</button>
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
        <section
          class="card task-card"
          class:other-card={!card.courseId}
          style={card.hue !== undefined ? `--course-h:${card.hue}` : ''}
          use:masonryItem
          animate:flip={{ duration: 200 }}
          out:fade={{ duration: 150 }}
        >
          <div class="card-head">
            <div class="card-head-text">
              {#if card.title}
                <p class="kicker">{card.code}</p>
                <h2 class="card-title">{card.title}</h2>
              {:else}
                <h2 class="card-title">{card.code}</h2>
              {/if}
            </div>
            <span class="pill pill-idle open-count">{card.open.length + card.catchUp.length} open</span>
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
  {:else if tadaGroups.length === 0}
    <p class="empty">Nothing here yet — check something off.</p>
  {:else}
    <div class="card-grid">
      {#each tadaGroups as group (group.key)}
        <div class="day-divider" use:masonryItem>
          <p class="kicker">{group.label}</p>
        </div>
        {#each group.tasks as task (task.id)}
          <div
            class="card celebration-card"
            class:other-card={primaryHue(task) === undefined}
            style={primaryHue(task) !== undefined ? `--course-h:${primaryHue(task)}` : ''}
            use:masonryItem
            animate:flip={{ duration: 200 }}
            out:fade={{ duration: 150 }}
          >
            <div class="celebration-head">
              {#if task.type && task.type !== 'todo'}
                <span class="task-type-icon" title={TASK_TYPE_META[task.type]?.label ?? task.type}><TaskTypeIcon type={task.type} /></span>
              {/if}
              <span class="celebration-title">{task.title}</span>
            </div>
            <div class="celebration-meta">
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
              {#if task.completed_at}
                <span class="completion-time">{completionTimeLabel(task.completed_at)}</span>
              {/if}
            </div>
            {#if task.completion_note}
              <p class="completion-note">“{task.completion_note}”</p>
            {/if}
          </div>
        {/each}
      {/each}
    </div>
  {/if}
</div>

<style>
  .tasks-view {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .page-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .page-head h1 {
    font-size: 26px;
    letter-spacing: -0.015em;
  }
  .open-total {
    flex-shrink: 0;
  }

  /* Segmented-control look shared with AppearanceSettings.svelte's scheme
     picker (.seg) — same recipe, renamed for this file's own scope. */
  .tab-strip {
    display: inline-flex;
    width: fit-content;
    padding: 3px;
    gap: 2px;
    background: var(--hairline);
    border-radius: 999px;
  }
  .tab-strip button {
    padding: 6px 16px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 550;
    color: var(--muted);
    transition: var(--motion-fast) var(--ease);
  }
  .tab-strip button[aria-selected='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-card);
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
  .dot.neutral {
    background: var(--muted);
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

  /* True CSS-grid masonry (see src/lib/actions/masonry.ts): a fine
     grid-auto-rows lets each item claim exactly the row-tracks its own
     height needs via grid-row-end, so shorter cards don't leave a gap
     below them the way an even-row auto-fill grid would. row-gap stays 0
     — the visual gap is each item's own margin-bottom (below), which is
     what the JS span math is measuring against. align-items:start is
     load-bearing: without it a grid item stretches to fill its whole
     spanned row-area instead of sitting at its natural height.
     grid-auto-flow stays the default `row` (non-dense) so packing never
     reorders items out of DOM/tab order. This grid now lives inside
     main's default slot (not the old fixed overlay), so its breakpoints
     are @container against main's content-box per the repo's convention
     (mobile-shell.md) — thresholds tuned so a column stays close to
     TaskItem's ~300-380px comfortable width up through --content-max's
     1320px ceiling. */
  .card-grid {
    --masonry-gap: var(--space-4);
    display: grid;
    grid-auto-rows: 4px;
    row-gap: 0;
    column-gap: var(--masonry-gap);
    grid-template-columns: 1fr;
    align-items: start;
  }
  @container (min-width: 520px) {
    .card-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  @container (min-width: 860px) {
    .card-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  @container (min-width: 1160px) {
    .card-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .task-card,
  .celebration-card,
  .day-divider {
    margin-bottom: var(--masonry-gap);
    min-width: 0;
  }

  /* Progressive enhancement: once a browser natively supports CSS masonry
     (the `grid-lanes` proposal) it owns row placement and gap directly —
     masonry.ts's ResizeObserver span math becomes redundant (masonryItem
     itself no-ops in that branch; the !important here only guards a stale
     inline grid-row-end surviving from before support landed, e.g. across
     a bfcache restore). */
  @supports (display: grid-lanes) {
    .card-grid {
      display: grid-lanes;
      grid-auto-rows: unset;
      row-gap: var(--masonry-gap);
    }
    .task-card,
    .celebration-card,
    .day-divider {
      grid-row: auto !important;
      margin-bottom: 0;
    }
  }

  @container (max-width: 520px) {
    .page-head h1 {
      font-size: 21px;
    }
  }

  /* Hue accent + hover: shared identity language for both the per-course
     card and the Ta-Da celebration card. border-top (not an inset
     box-shadow) because --shadow-card is `none` in the compass theme —
     box-shadow can't mix a `none` component into a comma list, but a
     plain border composes fine regardless of what --shadow-card is doing.
     Hover swaps the whole box-shadow to --shadow-pop (defined in every
     theme, never `none`), so this stays tokens-only across all 3 themes. */
  .task-card,
  .celebration-card {
    border-top: 3px solid var(--course);
    transition: transform var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease);
  }
  .task-card.other-card,
  .celebration-card.other-card {
    border-top-color: var(--border);
  }
  .task-card:hover,
  .celebration-card:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-pop);
  }

  .card-head-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .card-head-text .kicker,
  .card-head-text .card-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .open-count {
    flex-shrink: 0;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
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
  .task-row.completed .task-title {
    text-decoration: line-through;
    color: var(--muted);
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

  /* Quiet footer: a hairline rule separates it from the open/catch-up
     rows above, muted summary text keeps it from competing with them. */
  .done-disclosure {
    margin-top: var(--space-2);
    border-top: 1px solid var(--hairline);
    padding-top: var(--space-2);
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

  /* Ta-Da celebration cards: compact — a type icon + title, course dots +
     completion time on their own meta line, and the completion_note (when
     present) as a quoted line. No strikethrough, no checkbox: it's a
     trophy shelf, not the open-tab task row. */
  .celebration-card {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .celebration-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .celebration-title {
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .celebration-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  .course-dots {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }
  .completion-time {
    white-space: nowrap;
  }
  .completion-note {
    font-style: italic;
    font-size: 12.5px;
    color: var(--muted);
    overflow-wrap: break-word;
  }

  /* Full-width section break between day groups — grid-column:1/-1 forces
     non-dense auto-placement to start every card after it on a fresh row
     across all columns, which is what keeps one day's cards from mixing
     with the next day's in the same column. */
  .day-divider {
    grid-column: 1 / -1;
    padding-top: var(--space-2);
    border-top: 1px solid var(--hairline);
  }
  .day-divider:first-child {
    border-top: none;
    padding-top: 0;
  }
  .day-divider .kicker {
    margin: 0;
  }

  /* Touch ergonomics on /tasks — @media (not @container) since these are
     viewport-keyed touch-target bumps, not layout reflow (mirrors the
     rule of thumb documented on AppShell.astro's `main`). Placed last in
     this file so every property here wins its cascade tie against the
     earlier-equal-specificity base rules it targets (.chevron-btn,
     .task-checkbox, .children, .inline-add) — an @media block earlier in
     source order does NOT automatically beat an unwrapped rule of the same
     specificity that appears after it. */
  @media (max-width: 767px) {
    .chip-row {
      flex-wrap: nowrap;
      overflow-x: auto;
      scroll-snap-type: x proximity;
      scroll-padding-inline: var(--content-pad-x);
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .chip-row::-webkit-scrollbar {
      display: none;
    }
    .chip-row .chip {
      flex-shrink: 0;
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      scroll-snap-align: start;
    }

    /* Defensive wrap: covers both the per-card add form (title + date +
       Add) and the subtask add form (title + Add) — the 100% basis on the
       text input forces it onto its own line either way. */
    .inline-add {
      flex-wrap: wrap;
    }
    .inline-add input[type='text'] {
      flex: 1 1 100%;
    }

    /* Bigger tap target, same 18px glyph: box-sizing switches to
       content-box just for this rule so padding grows the hit area
       instead of eating into it, then the negative margin gives the
       surrounding layout its space back. */
    .chevron-btn {
      box-sizing: content-box;
      padding: 13px;
      margin: -11px -13px -13px;
    }

    .task-checkbox {
      transform: scale(1.25);
    }

    /* Same title-crush defense as TaskItem.svelte's mobile block: drop
       actions to their own full-width row (flex-basis:100% forces it
       unconditionally) rather than fighting the title for the row's width
       — phone card widths are the narrow end this row has to hold up at,
       and the touch-target bump just below makes Delete/Not-today wider
       here than on desktop, not narrower. */
    .task-row {
      flex-wrap: wrap;
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

    .children {
      margin-left: 14px;
    }

    .card-grid {
      --masonry-gap: 12px;
    }
  }
</style>
