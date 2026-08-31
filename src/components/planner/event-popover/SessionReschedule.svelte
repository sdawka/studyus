<script lang="ts">
  // study_session only (v1.6): ±30 min nudge rather than a date/time input.
  // PATCH /sessions/:id 409s once the session is completed, so EventPopover
  // hides this block for those rather than rendering it disabled-but-clickable.
  import type { CalendarItem } from '../../../lib/types/calendar';
  import { apiFetch } from '../../../lib/apiClient';
  import { addMinutes } from '../../../lib/plannerDates';

  let {
    item,
    onRescheduled,
  }: {
    item: CalendarItem;
    onRescheduled: (date: string, endDate: string | null) => void;
  } = $props();

  let rescheduling = $state(false);
  let rescheduleError = $state<string | null>(null);

  async function nudge(deltaMinutes: number) {
    const prevDate = item.date;
    const prevEnd = item.end_date;
    const newStart = addMinutes(new Date(item.date), deltaMinutes).toISOString();
    const newEnd = item.end_date ? addMinutes(new Date(item.end_date), deltaMinutes).toISOString() : null;
    rescheduling = true;
    rescheduleError = null;
    onRescheduled(newStart, newEnd);
    try {
      const result = await apiFetch(
        `/api/v1/sessions/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scheduled_at: newStart }),
        },
        'Could not reschedule this session.',
      );
      if (!result.ok) {
        onRescheduled(prevDate, prevEnd);
        rescheduleError = result.error;
      }
    } finally {
      rescheduling = false;
    }
  }
</script>

<div class="quick-actions">
  <span class="qa-label">Reschedule</span>
  <button type="button" class="btn btn-secondary qa-btn" onclick={() => nudge(-30)} disabled={rescheduling}>−30 min</button>
  <button type="button" class="btn btn-secondary qa-btn" onclick={() => nudge(30)} disabled={rescheduling}>+30 min</button>
</div>
{#if rescheduleError}<p class="pop-error">{rescheduleError}</p>{/if}

<style>
  .quick-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .qa-label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-right: 2px;
  }
  .qa-btn {
    padding: 4px 9px;
    font-size: 11.5px;
  }
  .pop-error {
    color: var(--danger);
    font-size: 12px;
  }
</style>
