<script lang="ts">
  // Home's task hero: SSR-seeds the shared task store (hydrateTasks —
  // first-hydrator-wins, so whichever island mounts first on this page
  // owns the initial fill) then renders live from it, so a checkbox toggle
  // or a wellness-chip add here is instantly visible to any other
  // task-consuming island mounted on the same page (e.g. TodoDropdown).
  import TaskItem from '../tasks/TaskItem.svelte';
  import { addTask, bucketByDue, hydrateTasks, recentlyCompletedIds, selectOpen, tasksList, type ApiTask } from '../../lib/stores/tasks';
  import { taskDepart } from '../../lib/completionMotion';

  interface CourseOption {
    id: string;
    code: string;
    hue: number;
  }

  interface Props {
    initialTasks: ApiTask[];
    courses: CourseOption[];
  }

  let { initialTasks, courses }: Props = $props();

  hydrateTasks(initialTasks);

  let courseHues = $derived.by(() => {
    const map: Record<string, number> = {};
    for (const c of courses) map[c.id] = c.hue;
    return map;
  });

  // A just-completed row holds its place for COMPLETION_HOLD_MS instead of
  // vanishing on the optimistic flip, so the check, the strikethrough and
  // the confetti are all watchable before the row bows out via taskDepart.
  // Same mechanism TasksView uses: grace-held tasks are genuinely completed,
  // so they're passed through the `open` classification with the flag faked
  // off, then mapped back to the real (completed) objects that actually
  // render — TaskItem needs the true flag to draw the struck-through state.
  let graceIds = $derived($recentlyCompletedIds);
  let openTasks = $derived.by(() => {
    const all = $tasksList;
    const graceHeld = (t: ApiTask) => t.completed && graceIds.has(t.id);
    const candidates = all
      .filter((t) => !t.completed || graceHeld(t))
      .map((t) => (graceHeld(t) ? { ...t, completed: false } : t));
    const byId = new Map(all.map((t) => [t.id, t]));
    return selectOpen(candidates).map((t) => byId.get(t.id) ?? t);
  });
  let buckets = $derived(bucketByDue(openTasks));

  // "Next" from the store is unbounded (everything after today, undated
  // tail last) — the card itself narrows that to a 7-day look-ahead before
  // applying the row cap, so a task due in three weeks doesn't crowd out
  // nearer ones; undated tasks (stale_kc's "anytime" policy) always pass,
  // matching the store's intent of always surfacing them somewhere.
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

  // One-tap wellness chips: hardcoded, no recurrence engine (plan decision
  // #4) — a tap just mints a plain today-todo.
  const WELLNESS_CHIPS = ['Take a walk', 'Message family', 'Drink water', 'Tidy desk'];
  let flashedChip = $state<string | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function todayNoonIso(): string {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  }

  async function mintWellness(title: string) {
    flashedChip = title;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashedChip = null;
    }, 1000);
    try {
      await addTask({ title, due_date: todayNoonIso() });
    } catch {
      // addTask already surfaces the failure via tasksError; the chip
      // flash is just a tap acknowledgment, not a success indicator.
    }
  }
</script>

<section class="card">
  <div class="card-head">
    <h2 class="card-title">Today</h2>
    <a class="footer-link" href="/tasks">All tasks →</a>
  </div>

  {#if isEmpty}
    <p class="empty">Nothing on your plate — you're caught up.</p>
  {:else}
    {#if buckets.overdue.length > 0}
      <div class="section">
        <p class="kicker section-label">Overdue <span class="count">· {buckets.overdue.length}</span></p>
        <!-- Depart wrapper: when the completion hold expires and the row
             leaves `open`, taskDepart collapses its height and one .rows gap
             so the rows below glide up instead of snapping. -->
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
        <p class="kicker section-label">Today <span class="count">· {buckets.today.length}</span></p>
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
        <p class="kicker section-label">Next 7 days <span class="count">· {nextInWindow.length}</span></p>
        <div class="rows">
          {#each nextRows as task (task.id)}
            <div class="depart-wrap" out:taskDepart={{ gap: 6 }}>
              <TaskItem {task} compact={false} {courseHues} />
            </div>
          {/each}
        </div>
        {#if nextOverflow > 0}
          <a class="more-link" href="/tasks">+{nextOverflow} more →</a>
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

  <div class="wellness">
    <p class="kicker">For you</p>
    <div class="chips">
      {#each WELLNESS_CHIPS as label (label)}
        <button type="button" class="chip" aria-pressed={flashedChip === label} onclick={() => mintWellness(label)}>
          {label}
        </button>
      {/each}
    </div>
  </div>
</section>

<style>
  /* .footer-link is normally a full-width popover footer (block, top
     hairline, centered) — reused here per spec for the "All tasks" link,
     adapted to sit inline in .card-head's flex row instead. */
  .card-head :global(.footer-link) {
    display: inline;
    border-top: none;
    padding: 0;
    text-align: right;
    white-space: nowrap;
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
  /* Plate-size at a glance: same kicker voice, slightly recessed so the
     word stays the label and the number stays an aside. */
  .section-label .count {
    font-weight: 500;
    letter-spacing: 0;
    opacity: 0.75;
  }
  .rows {
    display: grid;
    /* minmax(0,1fr), not the implicit `auto` track: auto sizes to the widest
       row's max-content, so a long practice_kc title makes the track (and the
       page) wider than the card instead of letting .task-title ellipsize. */
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  /* The depart wrapper is now the grid item, so the minmax(0,1fr) chain has
     to continue through it — without min-width:0 it takes its min-content
     width and long task titles push the card (and the page) wide. */
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
     danger styling; TaskItem already renders these with a "catch up" idle
     pill, never the red overdue one). */
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

  .wellness {
    margin-top: var(--space-5, 18px);
    padding-top: var(--space-4, 14px);
    border-top: 1px solid var(--hairline);
  }
  .wellness .kicker {
    margin-bottom: var(--space-2, 8px);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* The old ≤480 rule hiding Delete/Not-today is gone: quick actions moved
     into TaskQuickActions' hover/disclosure cluster, which costs a row no
     at-rest width — so phone-width dashboard rows keep every affordance
     (via the ⋯ disclosure) instead of losing them to the title crush. */
</style>
