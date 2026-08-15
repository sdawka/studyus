<script lang="ts">
  import type { CalendarItem } from '../../lib/types/calendar';
  import { apiFetch } from '../../lib/apiClient';
  import { hueFor } from '../../lib/courseHue';
  import { addMinutes, calendarItemTimeLabel } from '../../lib/plannerDates';
  import { bindPopoverDismiss } from '../shell/popover.svelte.ts';
  import { tasksById, toggleTask } from '../../lib/stores/tasks';
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
    item,
    course,
    anchorRect,
    onClose,
    onDeleted,
    onTaskToggled,
    onItemUpdated,
    plannerLink,
  }: {
    item: CalendarItem;
    course: CourseOption | undefined;
    anchorRect: { x: number; y: number; width: number; height: number };
    onClose: () => void;
    onDeleted?: () => void;
    // task_due only: fired after a toggle settles (optimistic flip included)
    // with the id/done pair actually applied, so the parent's items array
    // (WeekGrid/PlannerRail read from it) can be kept in sync — this popover
    // may be showing an item copied out of that array, not the live object.
    onTaskToggled?: (itemId: string, done: boolean) => void;
    // Generic counterpart of onTaskToggled for the other in-popover edits
    // below (study_session reschedule, class_session status/note) — same
    // "propagate the settled value back to the parent's array" contract,
    // just carrying whatever fields actually changed instead of one boolean.
    onItemUpdated?: (itemId: string, patch: Partial<CalendarItem>) => void;
    // dashboard/WeekView passes a `/planner?event=...` deep link so its
    // in-place popover can still hand off to the full planner; PlannerView
    // itself is already the planner, so it never passes this.
    plannerLink?: string | null;
  } = $props();

  let panelEl = $state<HTMLElement | null>(null);
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);
  let deleteConfirming = $state(false);
  let taskToggling = $state(false);

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
      case 'class_session':
        return 'Class session';
    }
  });

  // Manual-source logged events can be deleted from here; seeded/session/tutor
  // events and deadlines cannot. study_session has its own DELETE endpoint
  // (v1.6) with an inline confirm step below, rather than reusing this
  // instant-delete path — class_session has no DELETE endpoint at all
  // (attendance is corrected via PATCH, not by removing the row).
  const canDeleteEvent = $derived(item.type === 'event_logged' && item.details?.source === 'manual');
  const canDeleteSession = $derived(item.type === 'study_session');

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
    if (canDeleteEvent) {
      deleting = true;
      deleteError = null;
      try {
        const result = await apiFetch(`/api/v1/events/${item.id}`, { method: 'DELETE' }, 'Could not delete this event.');
        if (!result.ok) {
          deleteError = result.error;
          return;
        }
        onDeleted?.();
        onClose();
      } finally {
        deleting = false;
      }
      return;
    }
    if (canDeleteSession) {
      if (!deleteConfirming) {
        deleteConfirming = true;
        return;
      }
      deleting = true;
      deleteError = null;
      try {
        const result = await apiFetch(`/api/v1/sessions/${item.id}`, { method: 'DELETE' }, 'Could not delete this session.');
        if (!result.ok) {
          deleteError = result.error;
          deleteConfirming = false;
          return;
        }
        onDeleted?.();
        onClose();
      } finally {
        deleting = false;
      }
    }
  }

  // task_due items carry the raw task id (see getCalendar in
  // src/lib/services/calendar.ts — no prefix). If the tasks store already
  // has this task hydrated, go through it so every other store-backed
  // surface (TasksCard, TaskItem, TodoDropdown) sees the flip too; planner
  // pages don't hydrate the full store, so fall back to a direct PATCH.
  // Either way, flip item.details.done optimistically and re-derive it from
  // whatever actually lands (toggleTask swallows its own failures and rolls
  // its snapshot back rather than throwing), then bubble onTaskToggled so
  // the parent's items array — WeekGrid/PlannerRail read from that, not
  // from this popover's copy — stays in sync.
  async function handleTaskToggle() {
    if (item.type !== 'task_due') return;
    const id = item.id;
    const nextDone = !(item.details?.done === true);
    taskToggling = true;
    item.details = { ...item.details, done: nextDone };
    onTaskToggled?.(id, nextDone);
    try {
      if (tasksById.get()[id]) {
        await toggleTask(id);
        const settled = tasksById.get()[id];
        const finalDone = settled ? settled.completed : nextDone;
        if (finalDone !== nextDone) {
          item.details = { ...item.details, done: finalDone };
          onTaskToggled?.(id, finalDone);
        }
      } else {
        // Either failure mode (non-ok response or the request never landing)
        // reverts identically, so there's nothing left for a catch to do.
        const result = await apiFetch(`/api/v1/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completed: nextDone }),
        });
        if (!result.ok) {
          item.details = { ...item.details, done: !nextDone };
          onTaskToggled?.(id, !nextDone);
        }
      }
    } finally {
      taskToggling = false;
    }
  }

  // --- study_session quick actions (v1.6) -----------------------------------
  let rescheduling = $state(false);
  let rescheduleError = $state<string | null>(null);

  // ±30 min nudge rather than a date/time input — PATCH /sessions/:id 409s
  // once the session is completed, so the buttons are hidden for those in
  // the template rather than disabled-but-clickable.
  async function nudgeSession(deltaMinutes: number) {
    if (item.type !== 'study_session') return;
    const prevDate = item.date;
    const prevEnd = item.end_date;
    const newStart = addMinutes(new Date(item.date), deltaMinutes);
    const newEnd = item.end_date ? addMinutes(new Date(item.end_date), deltaMinutes).toISOString() : null;
    rescheduling = true;
    rescheduleError = null;
    item.date = newStart.toISOString();
    item.end_date = newEnd;
    onItemUpdated?.(item.id, { date: item.date, end_date: item.end_date });
    try {
      const result = await apiFetch(
        `/api/v1/sessions/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scheduled_at: newStart.toISOString() }),
        },
        'Could not reschedule this session.',
      );
      if (!result.ok) {
        item.date = prevDate;
        item.end_date = prevEnd;
        onItemUpdated?.(item.id, { date: prevDate, end_date: prevEnd });
        rescheduleError = result.error;
      }
    } finally {
      rescheduling = false;
    }
  }

  // --- class_session quick actions (v1.6) -----------------------------------
  let statusUpdating = $state(false);
  let statusError = $state<string | null>(null);

  async function setClassStatus(next: 'attended' | 'missed' | null) {
    if (item.type !== 'class_session') return;
    const prevStatus = (item.details?.status as 'attended' | 'missed' | null | undefined) ?? null;
    if (prevStatus === next) return;
    statusUpdating = true;
    statusError = null;
    item.details = { ...item.details, status: next };
    onItemUpdated?.(item.id, { details: { status: next } });
    try {
      const result = await apiFetch(
        `/api/v1/class-sessions/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: next }),
        },
        'Could not update attendance.',
      );
      if (!result.ok) {
        item.details = { ...item.details, status: prevStatus };
        onItemUpdated?.(item.id, { details: { status: prevStatus } });
        statusError = result.error;
      }
    } finally {
      statusUpdating = false;
    }
  }

  let noteDraft = $state(typeof item.details?.note === 'string' ? (item.details.note as string) : '');
  let savingNote = $state(false);
  let noteError = $state<string | null>(null);
  const noteDirty = $derived(noteDraft !== (typeof item.details?.note === 'string' ? item.details.note : ''));

  async function saveNote() {
    if (item.type !== 'class_session') return;
    const prevNote: string | null = typeof item.details?.note === 'string' ? (item.details.note as string) : null;
    const next = noteDraft.trim() ? noteDraft : null;
    savingNote = true;
    noteError = null;
    item.details = { ...item.details, note: next };
    onItemUpdated?.(item.id, { details: { note: next } });
    try {
      const result = await apiFetch(
        `/api/v1/class-sessions/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note: next }),
        },
        'Could not save note.',
      );
      if (!result.ok) {
        item.details = { ...item.details, note: prevNote };
        onItemUpdated?.(item.id, { details: { note: prevNote } });
        noteError = result.error;
        noteDraft = prevNote ?? '';
      }
    } finally {
      savingNote = false;
    }
  }
</script>

{#snippet body()}
  <p class="pop-time num">{calendarItemTimeLabel(item)}</p>
  <div class="pop-meta">
    {#if course}
      <span class="chip pop-chip">{course.code}</span>
    {/if}
    <span class="pill pill-idle">{typeLabel}</span>
  </div>
  {#if item.type === 'task_due'}
    <label class="task-toggle">
      <input
        type="checkbox"
        checked={item.details?.done === true}
        disabled={taskToggling}
        onchange={handleTaskToggle}
      />
      <span>{item.details?.done === true ? 'Completed' : 'Mark complete'}</span>
    </label>
  {/if}
  {#if detailLines.length}
    <ul class="pop-details">
      {#each detailLines as line}
        <li>{line}</li>
      {/each}
    </ul>
  {/if}

  {#if item.type === 'study_session' && !item.details?.completed}
    <div class="quick-actions">
      <span class="qa-label">Reschedule</span>
      <button type="button" class="btn btn-secondary qa-btn" onclick={() => nudgeSession(-30)} disabled={rescheduling}>−30 min</button>
      <button type="button" class="btn btn-secondary qa-btn" onclick={() => nudgeSession(30)} disabled={rescheduling}>+30 min</button>
    </div>
    {#if rescheduleError}<p class="pop-error">{rescheduleError}</p>{/if}
  {/if}

  {#if item.type === 'class_session'}
    {@const status = (item.details?.status as 'attended' | 'missed' | null | undefined) ?? null}
    <div class="quick-actions">
      <span class="qa-label">Attendance</span>
      <button type="button" class="btn btn-secondary qa-btn" class:qa-active={status === 'attended'} onclick={() => setClassStatus('attended')} disabled={statusUpdating}>
        ✓ Attended
      </button>
      <button type="button" class="btn btn-secondary qa-btn" class:qa-active={status === 'missed'} onclick={() => setClassStatus('missed')} disabled={statusUpdating}>
        ✗ Missed
      </button>
      {#if status}
        <button type="button" class="btn btn-secondary qa-btn" onclick={() => setClassStatus(null)} disabled={statusUpdating}>Clear</button>
      {/if}
    </div>
    {#if statusError}<p class="pop-error">{statusError}</p>{/if}
    <label class="field">
      <span class="field-label">Note</span>
      <textarea bind:value={noteDraft} rows="2" maxlength="2000" placeholder="Add a note…"></textarea>
    </label>
    <button type="button" class="btn btn-secondary" onclick={saveNote} disabled={savingNote || !noteDirty}>
      {savingNote ? 'Saving…' : 'Save note'}
    </button>
    {#if noteError}<p class="pop-error">{noteError}</p>{/if}
  {/if}

  {#if deleteError}<p class="pop-error">{deleteError}</p>{/if}
  <div class="pop-actions">
    {#if item.href}
      <a class="btn btn-secondary" href={item.href}>Open →</a>
    {/if}
    {#if plannerLink}
      <a class="btn btn-secondary" href={plannerLink}>Open in planner →</a>
    {/if}
    {#if canDeleteEvent}
      <button type="button" class="btn pop-delete" onclick={handleDelete} disabled={deleting}>
        {deleting ? 'Deleting…' : 'Delete'}
      </button>
    {/if}
    {#if canDeleteSession}
      {#if deleteConfirming}
        <span class="confirm-row">
          <span class="confirm-label">Delete this session?</span>
          <button type="button" class="btn pop-delete" onclick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Confirm'}</button>
          <button type="button" class="btn btn-secondary" onclick={() => (deleteConfirming = false)} disabled={deleting}>Cancel</button>
        </span>
      {:else}
        <button type="button" class="btn pop-delete" onclick={handleDelete}>Delete</button>
      {/if}
    {/if}
  </div>
{/snippet}

{#if $isMobile}
  <Sheet open={true} onClose={onClose} title={item.title}>
    <div class="event-popover-body" style={`--course-h:${hue}`}>
      {@render body()}
    </div>
  </Sheet>
{:else}
  <div class="event-popover popover" bind:this={panelEl} style={`${style} --course-h:${hue}; --pop-w: 288px`} role="dialog" aria-label={item.title}>
    <div class="pop-head">
      <p class="pop-title">{item.title}</p>
      <button type="button" class="close-btn" aria-label="Close" onclick={onClose}>×</button>
    </div>
    {@render body()}
  </div>
{/if}

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
  .task-toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    color: var(--text);
    cursor: pointer;
  }
  .task-toggle input {
    cursor: pointer;
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
  .qa-btn.qa-active {
    background: var(--accent-soft);
    color: var(--accent-ink);
    border-color: var(--accent);
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
  .field textarea {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
  }
  .pop-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 2px;
  }
  .pop-delete {
    background: var(--danger-soft);
    color: var(--danger-ink);
    border: 1px solid transparent;
  }
  .confirm-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .confirm-label {
    font-size: 12px;
    color: var(--text);
  }
  /* Sheet.svelte's .sheet-body already provides the panel chrome (padding,
     scroll); this just reproduces the desktop .popover recipe's internal
     flex/gap so the same content reads the same in both presentations. */
  .event-popover-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
