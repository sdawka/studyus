<script lang="ts">
  // The read-only half of EventPopover: what this item IS. No requests, no
  // state, nothing to roll back — every mutating affordance lives in one of
  // the sibling components instead.
  import type { CalendarItem, CalendarItemType } from '../../../lib/types/calendar';
  import { calendarItemTimeLabel } from '../../../lib/plannerDates';
  import type { CourseOption } from './types';

  let { item, course }: { item: CalendarItem; course: CourseOption | undefined } = $props();

  // A Record rather than a switch: TypeScript fails the build when a new
  // CalendarItemType is added without a label here, which a switch with no
  // default silently allowed (external_event shipped with a blank pill).
  const TYPE_LABELS: Record<CalendarItemType, string> = {
    assessment_due: 'Assessment due',
    task_due: 'Task due',
    study_session: 'Study session',
    event_logged: 'Logged event',
    class_session: 'Class session',
    external_event: 'Imported event',
  };
  const typeLabel = $derived(TYPE_LABELS[item.type]);

  // all_day items have no meaningful clock time — the ISO date is a noon
  // anchor, not an instant — so rendering a range would be a fabrication.
  // AgendaList and dashboard/WeekView already suppress the time for these.
  const whenLabel = $derived(item.all_day ? 'All day' : calendarItemTimeLabel(item));

  const detailLines = $derived.by(() => {
    const d = item.details ?? {};
    const lines: string[] = [];
    if (item.type === 'assessment_due') {
      if (typeof d.assessment_type === 'string') lines.push(`Type: ${d.assessment_type}`);
      if (typeof d.weight_pct === 'number') lines.push(`Worth ${d.weight_pct}% of final grade`);
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
</script>

<p class="pop-time num">{whenLabel}</p>
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

<style>
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
</style>
