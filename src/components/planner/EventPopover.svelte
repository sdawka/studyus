<script lang="ts">
  import type { CalendarItem } from '../../lib/types/calendar';
  import { hueFor } from '../../lib/courseHue';
  import { timeRangeLabel } from '../../lib/plannerDates';
  import { bindPopoverDismiss } from '../shell/popover.svelte.ts';

  interface CourseOption {
    id: string;
    slug: string;
    code: string;
    title: string;
    color: number | null;
  }

  let {
    item,
    course,
    anchorRect,
    onClose,
    onDeleted,
  }: {
    item: CalendarItem;
    course: CourseOption | undefined;
    anchorRect: { x: number; y: number; width: number; height: number };
    onClose: () => void;
    onDeleted?: () => void;
  } = $props();

  let panelEl = $state<HTMLElement | null>(null);
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);

  const hue = $derived(course ? hueFor({ slug: course.slug, color: course.color === null ? null : String(course.color) }) : 220);

  const typeLabel = $derived.by(() => {
    switch (item.type) {
      case 'assessment_due':
        return 'Assessment due';
      case 'task_due':
        return 'Task due';
      case 'study_session':
        return 'Study session';
      case 'event_logged':
        return 'Logged event';
    }
  });

  // Manual-source logged events can be deleted from here; seeded/session/tutor
  // events and deadlines/sessions cannot (sessions have no DELETE endpoint yet).
  const canDelete = $derived(item.type === 'event_logged' && item.details?.source === 'manual');

  const detailLines = $derived.by(() => {
    const d = item.details ?? {};
    const lines: string[] = [];
    if (item.type === 'assessment_due') {
      if (typeof d.assessment_type === 'string') lines.push(`Type: ${d.assessment_type}`);
      if (typeof d.weight_pct === 'number') lines.push(`Worth ${d.weight_pct}% of final grade`);
    } else if (item.type === 'task_due') {
      lines.push(d.done ? 'Completed' : 'Not completed');
    } else if (item.type === 'study_session') {
      if (typeof d.planned_minutes === 'number') lines.push(`${d.planned_minutes} min planned`);
      lines.push(d.completed ? 'Completed' : 'Scheduled');
      if (typeof d.intended_event_type === 'string') lines.push(`Focus: ${d.intended_event_type.replace(/_/g, ' ')}`);
    } else if (item.type === 'event_logged') {
      if (typeof d.kc_name === 'string' && d.kc_name) lines.push(`Concept: ${d.kc_name}`);
      if (typeof d.source === 'string') lines.push(`Source: ${d.source}`);
    }
    return lines;
  });

  const style = $derived.by(() => {
    const width = 288;
    const margin = 12;
    let left = anchorRect.x + anchorRect.width + 10;
    let top = anchorRect.y;
    if (typeof window !== 'undefined') {
      if (left + width + margin > window.innerWidth) left = Math.max(margin, anchorRect.x - width - 10);
      if (left + width + margin > window.innerWidth) left = window.innerWidth - width - margin;
      const estHeight = 240;
      if (top + estHeight + margin > window.innerHeight) top = Math.max(margin, window.innerHeight - estHeight - margin);
    }
    return `left:${left}px; top:${top}px;`;
  });

  bindPopoverDismiss({
    isOpen: () => true,
    close: onClose,
    anchorEl: () => panelEl,
  });

  async function handleDelete() {
    if (!canDelete) return;
    deleting = true;
    deleteError = null;
    try {
      const res = await fetch(`/api/v1/events/${item.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        deleteError = json?.error?.message ?? 'Could not delete this event.';
        return;
      }
      onDeleted?.();
      onClose();
    } catch {
      deleteError = 'Network error, please try again.';
    } finally {
      deleting = false;
    }
  }
</script>

<div class="event-popover popover" bind:this={panelEl} style={`${style} --course-h:${hue}; --pop-w: 288px`} role="dialog" aria-label={item.title}>
  <div class="pop-head">
    <p class="pop-title">{item.title}</p>
    <button type="button" class="close-btn" aria-label="Close" onclick={onClose}>×</button>
  </div>
  <p class="pop-time num">{timeRangeLabel(new Date(item.date), item.end_date ? new Date(item.end_date) : null)}</p>
  <div class="pop-meta">
    {#if course}
      <span class="chip pop-chip">{course.code}</span>
    {/if}
    <span class="pill pill-idle">{typeLabel}</span>
  </div>
  {#if detailLines.length}
    <ul class="pop-details">
      {#each detailLines as line}
        <li>{line}</li>
      {/each}
    </ul>
  {/if}
  {#if deleteError}<p class="pop-error">{deleteError}</p>{/if}
  <div class="pop-actions">
    {#if item.href}
      <a class="btn btn-secondary" href={item.href}>Open →</a>
    {/if}
    {#if canDelete}
      <button type="button" class="btn pop-delete" onclick={handleDelete} disabled={deleting}>
        {deleting ? 'Deleting…' : 'Delete'}
      </button>
    {/if}
  </div>
</div>

<style>
  .event-popover {
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
    font-size: 14.5px;
    font-weight: 650;
    line-height: 1.3;
  }
  .close-btn {
    font-size: 16px;
    color: var(--muted);
    line-height: 1;
    flex-shrink: 0;
  }
  .close-btn:hover {
    color: var(--text);
  }
  .pop-time {
    font-size: 12.5px;
    color: var(--muted);
  }
  .pop-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .pop-chip {
    background: var(--course-soft);
    color: var(--course-ink);
    border: none;
    padding: 3px 9px;
    font-size: 11.5px;
  }
  .pop-details {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12.5px;
    color: var(--text);
  }
  .pop-error {
    color: var(--danger);
    font-size: 12px;
  }
  .pop-actions {
    display: flex;
    gap: 8px;
    margin-top: 2px;
  }
  .pop-delete {
    background: var(--danger-soft);
    color: var(--danger-ink);
    border: 1px solid transparent;
  }
</style>
