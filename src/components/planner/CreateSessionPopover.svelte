<script lang="ts">
  import { bindPopoverDismiss } from '../shell/popover.svelte.ts';
  import { apiFetch } from '../../lib/apiClient';
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
    anchorRect,
    courses,
    onClose,
    onCreated,
  }: {
    start: Date;
    anchorRect: { x: number; y: number; width: number; height: number };
    courses: CourseOption[];
    onClose: () => void;
    onCreated: () => void;
  } = $props();

  let panelEl = $state<HTMLElement | null>(null);
  let courseId = $state<string>(courses[0]?.id ?? '');
  let duration = $state(30);
  let submitting = $state(false);
  let error = $state<string | null>(null);

  const style = $derived.by(() => {
    const width = 240;
    const margin = 12;
    let left = anchorRect.x + anchorRect.width + 10;
    let top = anchorRect.y;
    if (typeof window !== 'undefined') {
      if (left + width + margin > window.innerWidth) left = Math.max(margin, anchorRect.x - width - 10);
      const estHeight = 210;
      if (top + estHeight + margin > window.innerHeight) top = Math.max(margin, window.innerHeight - estHeight - margin);
    }
    return `left:${left}px; top:${top}px;`;
  });

  bindPopoverDismiss({
    isOpen: () => true,
    close: onClose,
    anchorEl: () => panelEl,
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitting = true;
    error = null;
    try {
      const result = await apiFetch(
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

  const timeLabel = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
</script>

{#snippet body()}
  <label class="field">
    <span class="field-label">Course</span>
    <select bind:value={courseId}>
      <option value="">General (no course)</option>
      {#each courses as c}
        <option value={c.id}>{c.code}</option>
      {/each}
    </select>
  </label>
  <label class="field">
    <span class="field-label">Duration</span>
    <select bind:value={duration}>
      <option value={15}>15 min</option>
      <option value={25}>25 min</option>
      <option value={30}>30 min</option>
      <option value={60}>60 min</option>
      <option value={90}>90 min</option>
    </select>
  </label>
  {#if error}<p class="pop-error">{error}</p>{/if}
  <button type="submit" class="btn btn-primary" disabled={submitting}>{submitting ? 'Adding…' : 'Add study block'}</button>
{/snippet}

{#if $isMobile}
  <Sheet open={true} onClose={onClose} title="Plan session">
    <form class="create-popover-body" onsubmit={handleSubmit}>
      <p class="pop-time num">{timeLabel}</p>
      {@render body()}
    </form>
  </Sheet>
{:else}
  <form class="create-popover popover" bind:this={panelEl} style={`${style} --pop-w: 240px`} onsubmit={handleSubmit}>
    <div class="pop-head">
      <p class="pop-title">New study block · {timeLabel}</p>
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
  .field select {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
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
