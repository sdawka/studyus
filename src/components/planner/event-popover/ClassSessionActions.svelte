<script lang="ts">
  // class_session only (v1.6): attendance status + a free-text note. Both
  // PATCH the same endpoint and both are last-request-wins.
  //
  // Nothing stops a second request starting before the first settles — the
  // buttons only go disabled after a DOM flush — so a response that has been
  // superseded must not roll back, raise an error, or clear the busy flag on
  // behalf of the request that replaced it. Each handler takes a sequence
  // number and acts on its result only while it is still the newest: the same
  // "stop keying in-flight state with a shared scalar" fix AssessmentsCard
  // got, except the identity that matters here is the request, since a
  // popover only ever holds one class_session.
  import type { CalendarItem } from '../../../lib/types/calendar';
  import { apiFetch } from '../../../lib/apiClient';
  import { currentAnalyticsSurface } from '../../../lib/analytics/client';

  type AttendanceStatus = 'attended' | 'missed' | null;

  let {
    item,
    onDetailsChanged,
  }: {
    item: CalendarItem;
    onDetailsChanged: (patch: Record<string, unknown>) => void;
  } = $props();

  const status = $derived((item.details?.status as AttendanceStatus | undefined) ?? null);

  let statusSeq = 0;
  let statusUpdating = $state(false);
  let statusError = $state<string | null>(null);

  async function setStatus(next: AttendanceStatus) {
    // Read through to the item rather than the `status` derived above: the
    // derived is a memo, and this guard has to see the value the previous
    // click already wrote synchronously, before any re-render.
    const prevStatus = (item.details?.status as AttendanceStatus | undefined) ?? null;
    if (prevStatus === next) return;
    const seq = ++statusSeq;
    statusUpdating = true;
    statusError = null;
    onDetailsChanged({ status: next });
    try {
      // The route buckets attendance_toggled by this header. This popover
      // mounts on more than one route (PlannerView on /planner, WeekView on
      // /dashboard), so it reports the surface it is actually on rather than
      // a hardcoded one; when analytics has not bootstrapped there is no
      // honest answer, so the header is omitted and the route falls back.
      const surface = currentAnalyticsSurface();
      const result = await apiFetch(
        `/api/v1/class-sessions/${item.id}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            ...(surface ? { 'X-Studyus-Analytics-Surface': surface } : {}),
          },
          body: JSON.stringify({ status: next }),
        },
        'Could not update attendance.',
      );
      if (seq !== statusSeq) return; // superseded by a later click
      if (!result.ok) {
        onDetailsChanged({ status: prevStatus });
        statusError = result.error;
      }
    } finally {
      if (seq === statusSeq) statusUpdating = false;
    }
  }

  // The draft is an override, not a copy: `null` means "showing whatever is
  // saved". Seeding $state from item.details.note instead forked the draft
  // from the prop at init time (state_referenced_locally) and made a failed
  // save overwrite text the user had typed while the request was in flight.
  let noteDraft = $state<string | null>(null);
  const savedNote = $derived(typeof item.details?.note === 'string' ? (item.details.note as string) : '');
  const noteValue = $derived(noteDraft ?? savedNote);
  const noteDirty = $derived(noteValue !== savedNote);
  let noteSeq = 0;
  let savingNote = $state(false);
  let noteError = $state<string | null>(null);

  async function saveNote() {
    const prevNote: string | null = typeof item.details?.note === 'string' ? (item.details.note as string) : null;
    const draftAtSave = noteValue;
    const next = draftAtSave.trim() ? draftAtSave : null;
    const seq = ++noteSeq;
    savingNote = true;
    noteError = null;
    onDetailsChanged({ note: next });
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
      if (seq !== noteSeq) return; // superseded by a later save
      if (!result.ok) {
        // Roll back the item, never the textarea — the draft is the user's
        // unsaved work and is what they would retry with.
        onDetailsChanged({ note: prevNote });
        noteError = result.error;
        return;
      }
      // Drop the override so the field tracks the saved value again, unless
      // the user has typed since this save started.
      if (noteDraft === draftAtSave) noteDraft = null;
    } finally {
      if (seq === noteSeq) savingNote = false;
    }
  }
</script>

<div class="quick-actions">
  <span class="qa-label">Attendance</span>
  <button
    type="button"
    class="btn btn-secondary qa-btn"
    class:qa-active={status === 'attended'}
    onclick={() => setStatus('attended')}
    disabled={statusUpdating}
  >
    ✓ Attended
  </button>
  <button
    type="button"
    class="btn btn-secondary qa-btn"
    class:qa-active={status === 'missed'}
    onclick={() => setStatus('missed')}
    disabled={statusUpdating}
  >
    ✗ Missed
  </button>
  {#if status}
    <button type="button" class="btn btn-secondary qa-btn" onclick={() => setStatus(null)} disabled={statusUpdating}>Clear</button>
  {/if}
</div>
{#if statusError}<p class="pop-error">{statusError}</p>{/if}
<label class="field">
  <span class="field-label">Note</span>
  <textarea
    value={noteValue}
    oninput={(e) => (noteDraft = e.currentTarget.value)}
    rows="2"
    maxlength="2000"
    placeholder="Add a note…"
  ></textarea>
</label>
<button type="button" class="btn btn-secondary" onclick={saveNote} disabled={savingNote || !noteDirty}>
  {savingNote ? 'Saving…' : 'Save note'}
</button>
{#if noteError}<p class="pop-error">{noteError}</p>{/if}

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
  .pop-error {
    color: var(--danger);
    font-size: 12px;
  }
</style>
