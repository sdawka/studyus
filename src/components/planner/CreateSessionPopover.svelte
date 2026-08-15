<script lang="ts">
  import { bindPopoverDismiss } from '../shell/popover.svelte.ts';
  import { apiFetch } from '../../lib/apiClient';
  import { addMinutes } from '../../lib/plannerDates';
  import { isMobile } from '../../lib/stores/viewport';
  import Sheet from '../shell/Sheet.svelte';

  interface CourseOption {
    id: string;
    slug: string;
    code: string;
    title: string;
    color: number | null;
  }

  let {
    start,
    end = null,
    anchorRect,
    courses,
    onClose,
    onCreated,
  }: {
    start: Date;
    // Present only for a WeekGrid drag-create — pre-fills `duration` from the
    // dragged range. A plain click/tap never passes this, and `duration`
    // keeps its existing 30-min default.
    end?: Date | null;
    anchorRect: { x: number; y: number; width: number; height: number };
    courses: CourseOption[];
    onClose: () => void;
    onCreated: () => void;
  } = $props();

  type CreateType = 'study' | 'class' | 'other';

  let panelEl = $state<HTMLElement | null>(null);
  let type = $state<CreateType>('study');
  let courseId = $state<string>(courses[0]?.id ?? '');
  let title = $state(''); // 'other' only

  // Preset durations plus whatever the drag actually produced — if the drag
  // range isn't one of the presets (e.g. 45 min), it's injected as an extra
  // option so it round-trips through the <select> instead of silently
  // snapping to the nearest preset the moment the popover opens.
  const PRESET_DURATIONS = [15, 25, 30, 60, 90];
  function initialDuration(): number {
    if (!end) return 30;
    return Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000));
  }
  let duration = $state(initialDuration());
  const durationOptions = $derived.by(() => {
    const set = new Set(PRESET_DURATIONS);
    set.add(duration);
    return [...set].sort((a, b) => a - b);
  });

  let submitting = $state(false);
  let error = $state<string | null>(null);

  const popTitle = $derived(type === 'study' ? 'New study block' : type === 'class' ? 'New class' : 'New task');
  const timeLabel = $derived.by(() => {
    const startLabel = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (type === 'other') return start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const endLabel = addMinutes(start, duration).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${startLabel} – ${endLabel}`;
  });

  const style = $derived.by(() => {
    const width = 264;
    const margin = 12;
    let left = anchorRect.x + anchorRect.width + 10;
    let top = anchorRect.y;
    if (typeof window !== 'undefined') {
      if (left + width + margin > window.innerWidth) left = Math.max(margin, anchorRect.x - width - 10);
      const estHeight = 260;
      if (top + estHeight + margin > window.innerHeight) top = Math.max(margin, window.innerHeight - estHeight - margin);
    }
    return `left:${left}px; top:${top}px;`;
  });

  bindPopoverDismiss({
    isOpen: () => true,
    close: onClose,
    anchorEl: () => panelEl,
  });

  function selectType(next: CreateType) {
    type = next;
    // Class requires a real course — if the user had switched to "General
    // (no course)" while on the Study tab, land on the first real course
    // instead of carrying an empty selection into a type that can't use it.
    if (next === 'class' && !courseId && courses[0]) courseId = courses[0].id;
  }

  // "Day noon" mirrors the app-wide due-date convention (see
  // dashboard/TodayTasks.svelte's todayNoonIso) — anchoring to local noon
  // instead of the exact drag time avoids a UTC day-boundary shift turning
  // a late-evening or early-morning drag into the wrong day once due_date
  // round-trips through storage.
  function dayNoonIso(d: Date): string {
    const r = new Date(d);
    r.setHours(12, 0, 0, 0);
    return r.toISOString();
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    error = null;

    if (type === 'class' && !courseId) {
      error = 'Choose a course for the class.';
      return;
    }
    if (type === 'other' && !title.trim()) {
      error = 'Add a title.';
      return;
    }

    let classStartMin = 0;
    let classEndMin = 0;
    if (type === 'class') {
      classStartMin = start.getHours() * 60 + start.getMinutes();
      classEndMin = classStartMin + duration;
      if (classEndMin > 1439) {
        error = "Class can't extend past midnight.";
        return;
      }
    }

    submitting = true;
    try {
      const result =
        type === 'study'
          ? await apiFetch(
              '/api/v1/sessions',
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  course_id: courseId || undefined,
                  intended_event_type: 'practice_done',
                  planned_minutes: duration,
                  scheduled_at: start.toISOString(),
                }),
              },
              'Could not create session.',
            )
          : type === 'class'
            ? await apiFetch(
                `/api/v1/courses/${courseId}/class-sessions`,
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ date: start.toISOString(), start_min: classStartMin, end_min: classEndMin }),
                },
                'Could not create class session.',
              )
            : await apiFetch(
                '/api/v1/tasks',
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    title: title.trim(),
                    due_date: dayNoonIso(start),
                    course_ids: courseId ? [courseId] : undefined,
                  }),
                },
                'Could not create task.',
              );
      if (!result.ok) {
        error = result.error;
        return;
      }
      onCreated();
      onClose();
    } finally {
      submitting = false;
    }
  }
</script>

{#snippet body()}
  <div class="type-picker" role="group" aria-label="Type">
    <button type="button" class="seg" class:active={type === 'study'} onclick={() => selectType('study')}>Study session</button>
    <button
      type="button"
      class="seg"
      class:active={type === 'class'}
      disabled={courses.length === 0}
      title={courses.length === 0 ? 'No courses yet' : undefined}
      onclick={() => selectType('class')}
    >
      Class
    </button>
    <button type="button" class="seg" class:active={type === 'other'} onclick={() => selectType('other')}>Other</button>
  </div>

  {#if type === 'other'}
    <label class="field">
      <span class="field-label">Title</span>
      <input type="text" bind:value={title} placeholder="e.g. Email professor" maxlength="300" />
    </label>
    <p class="pop-hint">Shows as due {start.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} (all-day).</p>
  {/if}

  <label class="field">
    <span class="field-label">Course{type === 'class' ? '' : ' (optional)'}</span>
    <select bind:value={courseId}>
      {#if type !== 'class'}
        <option value="">{type === 'other' ? 'No course' : 'General (no course)'}</option>
      {/if}
      {#each courses as c}
        <option value={c.id}>{c.code}</option>
      {/each}
    </select>
  </label>

  {#if type !== 'other'}
    <label class="field">
      <span class="field-label">Duration</span>
      <select bind:value={duration}>
        {#each durationOptions as d}
          <option value={d}>{d} min</option>
        {/each}
      </select>
    </label>
  {/if}

  {#if error}<p class="pop-error">{error}</p>{/if}
  <button type="submit" class="btn btn-primary" disabled={submitting}>
    {submitting ? 'Adding…' : type === 'study' ? 'Add study block' : type === 'class' ? 'Add class' : 'Add task'}
  </button>
{/snippet}

{#if $isMobile}
  <Sheet open={true} onClose={onClose} title={popTitle}>
    <form class="create-popover-body" onsubmit={handleSubmit}>
      <p class="pop-time num">{timeLabel}</p>
      {@render body()}
    </form>
  </Sheet>
{:else}
  <form class="create-popover popover" bind:this={panelEl} style={`${style} --pop-w: 264px`} onsubmit={handleSubmit}>
    <div class="pop-head">
      <p class="pop-title">{popTitle} · {timeLabel}</p>
      <button type="button" class="close-btn" aria-label="Close" onclick={onClose}>×</button>
    </div>
    {@render body()}
  </form>
{/if}

<style>
  .create-popover {
    position: fixed;
    z-index: 70;
    width: var(--pop-w);
    top: 0;
  }
  .pop-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  .pop-title {
    font-size: 13px;
    font-weight: 650;
    line-height: 1.3;
  }
  .close-btn {
    font-size: 16px;
    color: var(--muted);
    line-height: 1;
    flex-shrink: 0;
  }
  .type-picker {
    display: flex;
    gap: 4px;
  }
  .seg {
    flex: 1;
    padding: 6px 4px;
    font-size: 11.5px;
    font-weight: 560;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--muted);
    transition: background var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease);
  }
  .seg.active {
    background: var(--accent-soft);
    color: var(--accent-ink);
    border-color: var(--accent);
  }
  .seg:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .field-label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .field select,
  .field input {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
  }
  .pop-hint {
    font-size: 11px;
    color: var(--muted);
    margin-top: -4px;
  }
  .pop-error {
    color: var(--danger);
    font-size: 12px;
  }
  .pop-time {
    font-size: 12.5px;
    color: var(--muted);
  }
  /* Sheet.svelte's .sheet-body already provides the panel chrome (padding,
     scroll); this just reproduces the desktop .popover recipe's internal
     flex/gap so the same fields read the same in both presentations. */
  .create-popover-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
