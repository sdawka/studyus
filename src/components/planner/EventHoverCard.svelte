<script lang="ts">
  // Presentational hover-card peek — markup/styles extracted verbatim out of
  // WeekGrid.svelte (v1.6) so dashboard/WeekView's collapsed chips can reuse
  // the identical idiom instead of a second implementation. Positioning/delay
  // state lives in the paired eventHoverCard.svelte.ts hook; this component
  // only renders whatever item/pos it's handed.
  import type { CalendarItem } from '../../lib/types/calendar';
  import { hueFor } from '../../lib/courseHue';
  import { calendarItemTimeLabel } from '../../lib/plannerDates';

  interface CourseOption {
    id: string;
    slug: string;
    code: string;
    title: string;
    color: number | null;
  }

  let {
    item,
    pos,
    course,
  }: {
    item: CalendarItem;
    pos: { x: number; y: number };
    course: CourseOption | undefined;
  } = $props();

  const hue = $derived(course ? hueFor({ slug: course.slug, color: course.color === null ? null : String(course.color) }) : 220);

  function typeLabel(type: CalendarItem['type']): string {
    switch (type) {
      case 'assessment_due':
        return 'Due';
      case 'task_due':
        return 'Task';
      case 'study_session':
        return 'Study session';
      case 'event_logged':
        return 'Logged';
      case 'class_session':
        return 'Class';
    }
  }

  const label = $derived(typeLabel(item.type));

  function detailsSnippet(it: CalendarItem): string | null {
    const d = it.details ?? {};
    if (it.type === 'assessment_due' && typeof d.weight_pct === 'number') return `Worth ${d.weight_pct}% of grade`;
    if (it.type === 'study_session' && typeof d.planned_minutes === 'number') return `${d.planned_minutes} min planned`;
    if (it.type === 'event_logged' && typeof d.kc_name === 'string' && d.kc_name) return d.kc_name;
    if (it.type === 'class_session') {
      const status = d.status === 'attended' ? 'Attended' : d.status === 'missed' ? 'Missed' : 'Not marked';
      const note = typeof d.note === 'string' && d.note ? d.note : null;
      return note ? `${status} — ${note}` : status;
    }
    return null;
  }

  const detail = $derived(detailsSnippet(item));
</script>

<div class="hover-card" style={`left:${pos.x}px; top:${pos.y}px; --course-h:${hue}`}>
  <p class="hc-title">{item.title}</p>
  <p class="hc-time">{calendarItemTimeLabel(item)}</p>
  {#if course}
    <span class="chip hc-chip">{course.code}</span>
  {/if}
  <p class="hc-type">{label}</p>
  {#if detail}
    <p class="hc-detail">{detail}</p>
  {/if}
</div>

<style>
  .hover-card {
    position: fixed;
    z-index: 60;
    width: 220px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-pop);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    pointer-events: none;
  }
  /* Touch-affordance suppression, not layout: a hover card has no meaning
     without a hover-capable pointer, and leaving it reachable on touch would
     mean a stray long-press-adjacent event leaves a card stuck on screen
     with no hover-leave to dismiss it (see docs/design/mobile-shell.md's
     hover-vs-viewport-query rule). */
  @media (hover: none) {
    .hover-card {
      display: none;
    }
  }
  .hc-title {
    font-size: 13px;
    font-weight: 650;
  }
  .hc-time {
    font-size: 11.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .hc-chip {
    align-self: flex-start;
    padding: 2px 8px;
    font-size: 10.5px;
    background: var(--course-soft);
    color: var(--course-ink);
    border: none;
  }
  .hc-type {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .hc-detail {
    font-size: 11.5px;
    color: var(--text);
  }
</style>
