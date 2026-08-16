<script lang="ts">
  // Course home's task hero (task-oriented overview): this course's open
  // tasks in the same Overdue/Today/Next-7-days buckets TodayTasks uses on
  // the dashboard, so the two lead surfaces read identically — one idiom to
  // learn. Store-backed via the shared tasks store (parent island SSR-seeds
  // it with hydrateTasks), so a toggle here is instantly visible in
  // TodoDropdown and vice versa. Replaces the old rail TasksCard.
  import TaskItem from '../tasks/TaskItem.svelte';
  import { addTask, bucketByDue, recentlyCompletedIds, selectForCourse, selectOpen, tasksList, type ApiTask } from '../../lib/stores/tasks';
  import { taskDepart } from '../../lib/completionMotion';

  interface Props {
    courseId: string;
    courseSlug: string;
    courseCode: string;
    courseHues: Record<string, number>;
  }
  let { courseId, courseSlug, courseCode, courseHues }: Props = $props();

  let courseTasks = $derived(selectForCourse($tasksList, courseId));

  // Completion hold + depart, same mechanism as TodayTasks/TasksView: without
  // it the optimistic flip unmounts the row — and, because CompletionFlow
  // mounts inside TaskItem, the open dialog with it — in the same tick, so
  // pressing Done made the modal blink out mid-press. Grace-held tasks are
  // really completed, so they pass the `open` classification with the flag
  // faked off and then map back to the real objects that render struck through.
  let graceIds = $derived($recentlyCompletedIds);
  let openCourseTasks = $derived.by(() => {
    const graceHeld = (t: ApiTask) => t.completed && graceIds.has(t.id);
    const candidates = courseTasks
      .filter((t) => !t.completed || graceHeld(t))
      .map((t) => (graceHeld(t) ? { ...t, completed: false } : t));
    const byId = new Map(courseTasks.map((t) => [t.id, t]));
    return selectOpen(candidates).map((t) => byId.get(t.id) ?? t);
  });
  let buckets = $derived(bucketByDue(openCourseTasks));

  // Same 7-day look-ahead + cap as TodayTasks: "next" from the store is
  // unbounded, so a task due in three weeks would crowd out nearer ones;
  // undated tasks (stale_kc's "anytime" policy) always pass the window.
  const NEXT_CAP = 5;
  let sevenDayWindowEnd = $derived.by(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 8);
    return d.getTime();
  });
  let nextInWindow = $derived(buckets.next.filter((t) => !t.due_date || new Date(t.due_date).getTime() < sevenDayWindowEnd));
  let nextRows = $derived(nextInWindow.slice(0, NEXT_CAP));
  let nextOverflow = $derived(Math.max(0, nextInWindow.length - NEXT_CAP));

  let isEmpty = $derived(
    buckets.overdue.length === 0 && buckets.today.length === 0 && nextInWindow.length === 0 && buckets.catchUp.length === 0,
  );

  let newTitle = $state('');
  let adding = $state(false);

  async function quickAdd() {
    const title = newTitle.trim();
    if (!title) return;
    adding = true;
    try {
      await addTask({ title, course_ids: [courseId] });
      newTitle = '';
    } finally {
      adding = false;
    }
  }
</script>

<section class="card">
  <div class="card-head">
    <h2 class="card-title">To do</h2>
    <a class="footer-link head-link" href={`/tasks?course=${courseSlug}`}>All tasks →</a>
  </div>

  {#if isEmpty}
    <p class="empty">Nothing to do for {courseCode} — you're caught up.</p>
  {:else}
    {#if buckets.overdue.length > 0}
      <div class="section">
        <p class="kicker section-label">Overdue</p>
        <!-- Depart wrapper: collapses the row and one .rows gap when the
             completion hold expires, so the list tidies itself instead of
             blinking the row out from under the dialog. -->
        <div class="rows">
          {#each buckets.overdue as task (task.id)}
            <div class="depart-wrap" out:taskDepart={{ gap: 6 }}>
              <TaskItem {task} compact={false} {courseHues} />
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if buckets.today.length > 0}
      <div class="section">
        <p class="kicker section-label">Today</p>
        <div class="rows">
          {#each buckets.today as task (task.id)}
            <div class="depart-wrap" out:taskDepart={{ gap: 6 }}>
              <TaskItem {task} compact={false} {courseHues} />
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if nextRows.length > 0}
      <div class="section">
        <p class="kicker section-label">Next 7 days</p>
        <div class="rows">
          {#each nextRows as task (task.id)}
            <div class="depart-wrap" out:taskDepart={{ gap: 6 }}>
              <TaskItem {task} compact={false} {courseHues} />
            </div>
          {/each}
        </div>
        {#if nextOverflow > 0}
          <a class="more-link" href={`/tasks?course=${courseSlug}`}>+{nextOverflow} more →</a>
        {/if}
      </div>
    {/if}

    {#if buckets.catchUp.length > 0}
      <details class="catch-up">
        <summary>Catch up ({buckets.catchUp.length})</summary>
        <div class="rows">
          {#each buckets.catchUp as task (task.id)}
            <div class="depart-wrap" out:taskDepart={{ gap: 6 }}>
              <TaskItem {task} compact={false} {courseHues} />
            </div>
          {/each}
        </div>
      </details>
    {/if}
  {/if}

  <form class="quick-add" onsubmit={(e) => { e.preventDefault(); quickAdd(); }}>
    <input type="text" placeholder="Add a task for {courseCode}…" bind:value={newTitle} disabled={adding} />
  </form>
</section>

<style>
  /* .footer-link is normally a full-width, top-bordered popover footer —
     reused here for the head link, adapted to sit inline in .card-head's
     flex row (same override TodayTasks/TasksCard carried). */
  .head-link {
    display: inline;
    border-top: none;
    padding: 0;
    text-align: right;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .section {
    margin-top: var(--space-4, 14px);
  }
  .section:first-of-type {
    margin-top: 0;
  }
  .section-label {
    margin-bottom: var(--space-2, 8px);
  }
  .rows {
    display: grid;
    /* minmax(0,1fr), not the implicit `auto` track: auto sizes to the widest
       row's max-content, so a long practice_kc title would make the track
       (and the page) wider than the card instead of ellipsizing. */
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  /* The depart wrapper is the grid item now — the minmax(0,1fr) chain has to
     continue through it or long titles size it to min-content and widen the
     card. */
  .depart-wrap {
    min-width: 0;
  }
  .more-link {
    display: inline-block;
    margin-top: 6px;
    font-size: 12.5px;
    font-weight: 560;
    color: var(--muted);
  }
  .more-link:hover {
    color: var(--accent-ink);
  }

  /* Idle disclosure for past attend_class rows — deliberately quiet (no
     danger styling; TaskItem renders these with a "catch up" idle pill,
     never the red overdue one). */
  .catch-up {
    margin-top: var(--space-4, 14px);
  }
  .catch-up summary {
    list-style: none;
    cursor: pointer;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
    padding: 6px 0;
  }
  .catch-up summary::-webkit-details-marker {
    display: none;
  }
  .catch-up .rows {
    margin-top: 8px;
  }

  .quick-add {
    margin-top: var(--space-4, 14px);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }
  .quick-add input {
    width: 100%;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    background: var(--surface);
    color: var(--text);
  }
</style>
