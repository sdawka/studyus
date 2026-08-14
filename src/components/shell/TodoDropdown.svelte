<script lang="ts">
  import TaskItem from '../tasks/TaskItem.svelte';
  import { bindPopoverDismiss } from './popover.svelte.ts';
  import { courseContext } from '../../lib/stores/courseContext';
  import { addTask, ensureLoaded, selectOpen, tasksList, tasksStatus } from '../../lib/stores/tasks';
  import { isMobile } from '../../lib/stores/viewport';
  import Sheet from './Sheet.svelte';

  interface Course {
    id: string;
    code: string;
    color?: string | number | null;
    color_hue?: number | null;
  }

  interface Props {
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    courses?: Course[];
  }

  let { open, onToggle, onClose, courses = [] }: Props = $props();

  let anchorEl: HTMLElement | null = null;
  let newTitle = $state('');
  let adding = $state(false);
  // Quick-add defaults new tasks to the course we're viewing — visible as a
  // clearable chip so it's not invisible magic. `null` once the user clears
  // it, even if a course context is present.
  let quickAddCourseId = $state<string | null>(null);
  let quickAddCourseCleared = $state(false);

  let quickAddCourse = $derived(
    quickAddCourseCleared ? null : (quickAddCourseId ?? $courseContext?.id ?? null),
  );
  let quickAddCourseLabel = $derived(
    quickAddCourse ? courses.find((c) => c.id === quickAddCourse)?.code ?? null : null,
  );

  $effect(() => {
    if (open) {
      quickAddCourseId = null;
      quickAddCourseCleared = false;
      // Idle/errored → fetch; already ready or loading → no-op/piggyback.
      // The badge on the closed trigger relies on some other on-page
      // island (or a prior open) having populated the store already.
      void ensureLoaded();
    }
  });

  let courseHues = $derived.by(() => {
    const map: Record<string, number> = {};
    for (const c of courses) {
      const hue = c.color_hue ?? (c.color !== null && c.color !== undefined ? Number(c.color) : null);
      if (hue !== null && !Number.isNaN(hue)) map[c.id] = hue;
    }
    return map;
  });

  let openTasks = $derived(selectOpen($tasksList));
  let openCount = $derived(openTasks.length);
  let topSeven = $derived(
    [...openTasks]
      .sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      })
      .slice(0, 7),
  );

  bindPopoverDismiss({ isOpen: () => open, close: () => onClose(), anchorEl: () => anchorEl });

  async function quickAdd() {
    if (!newTitle.trim()) return;
    adding = true;
    try {
      const input: { title: string; course_ids?: string[] } = { title: newTitle.trim() };
      if (quickAddCourse) input.course_ids = [quickAddCourse];
      await addTask(input);
      newTitle = '';
    } finally {
      adding = false;
    }
  }
</script>

<div class="popover-anchor" bind:this={anchorEl}>
  <button type="button" class="icon-btn pill-btn" onclick={onToggle} aria-expanded={open} title="To-do" aria-label="To-do list">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 12l2 2 4-4 M5 5h14v14H5z" />
    </svg>
    <span class="pill-label">To-do</span>
    {#if openCount > 0}
      <span class="badge">{openCount > 9 ? '9+' : openCount}</span>
    {/if}
  </button>

  {#snippet panelContent()}
    <div class="panel-head">
      <span class="kicker">To-do ({openCount})</span>
    </div>

    <form class="quick-add" onsubmit={(e) => { e.preventDefault(); quickAdd(); }}>
      <div class="quick-add-row">
        <input type="text" placeholder="Quick add a task…" bind:value={newTitle} disabled={adding} />
        <button type="submit" disabled={adding || !newTitle.trim()} aria-label="Add task">+</button>
      </div>
      {#if quickAddCourseLabel}
        <span class="course-chip-inline">
          {quickAddCourseLabel}
          <button type="button" class="chip-clear" onclick={() => (quickAddCourseCleared = true)} aria-label="Don't link to course">×</button>
        </span>
      {/if}
    </form>

    {#if $tasksStatus === 'loading' && topSeven.length === 0}
      <p class="empty">Loading…</p>
    {:else if topSeven.length === 0}
      <p class="empty">No open tasks. Nicely done.</p>
    {:else}
      <div class="list">
        {#each topSeven as task (task.id)}
          <TaskItem {task} compact {courseHues} />
        {/each}
      </div>
    {/if}

    <a class="footer-link" href="/tasks">All tasks →</a>
  {/snippet}

  {#if open}
    {#if $isMobile}
      <Sheet {open} onClose={onClose} title="To-do">
        {@render panelContent()}
      </Sheet>
    {:else}
      <div class="popover panel" role="menu" style="--pop-w: var(--pop-w-md)">
        {@render panelContent()}
      </div>
    {/if}
  {/if}
</div>

<style>
  .popover-anchor { position: relative; }

  .badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: 9.5px;
    font-weight: 700;
    display: grid;
    place-items: center;
    line-height: 1;
  }

  .panel {
    max-height: 460px;
    overflow-y: auto;
  }

  /* Pill-on-hover, matching the Record event pill's language: the circular
     icon button widens to reveal a text label. Width transitions to an
     explicit px value (not `auto`) so it actually animates. */
  .pill-btn {
    display: inline-flex;
    align-items: center;
    width: 34px;
    overflow: hidden;
    transition: width var(--motion-base) var(--ease);
  }
  .pill-btn svg { flex-shrink: 0; margin-left: 8px; }
  .pill-btn .pill-label {
    max-width: 0;
    margin-left: 0;
    opacity: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 600;
    transition: max-width var(--motion-base) var(--ease), opacity var(--motion-base) var(--ease),
      margin-left var(--motion-base) var(--ease);
  }
  .pill-btn:hover,
  .pill-btn:focus-visible {
    width: 88px;
  }
  .pill-btn:hover .pill-label,
  .pill-btn:focus-visible .pill-label {
    max-width: 50px;
    margin-left: 6px;
    opacity: 1;
  }

  .quick-add { display: flex; flex-direction: column; gap: 6px; }
  .quick-add-row { display: flex; gap: 6px; }
  .quick-add input {
    flex: 1;
    min-width: 0;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    background: var(--surface);
    color: var(--text);
  }
  .quick-add button {
    width: 30px;
    border-radius: var(--radius-sm, 6px);
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: 15px;
    font-weight: 700;
  }
  .quick-add button:disabled { opacity: 0.5; }

  .course-chip-inline {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 8px;
    border-radius: 999px;
    background: var(--course-soft, var(--hairline));
    color: var(--course-ink, var(--muted));
    font-size: 11px;
    font-weight: 600;
  }
  .chip-clear {
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    color: inherit;
    opacity: 0.75;
    font-size: 11px;
    line-height: 1;
  }
  .chip-clear:hover { opacity: 1; background: color-mix(in oklch, currentColor 15%, transparent); }

  .list { display: flex; flex-direction: column; gap: 2px; }
</style>
