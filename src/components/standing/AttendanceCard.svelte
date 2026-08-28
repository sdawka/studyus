<script lang="ts">
  // Attendance lives as pre-generated class_sessions rows (one per meeting
  // day) whose status gets updated in place — not events appended by a
  // button click. See docs/api.md "Class sessions" for the contract.
  import { apiFetch } from '../../lib/apiClient';
  import { formatShortDate, formatWeekdayAndDate } from '../../lib/plannerDates';
  import { refetchTasks } from '../../lib/stores/tasks';

  interface Props {
    courseId: string;
    meetingDaysInitial: number[] | null;
  }
  let { courseId, meetingDaysInitial }: Props = $props();

  interface ClassSession {
    id: string;
    course_id: string;
    // Documented as ISO in the API contract, but currently comes back as a
    // raw epoch-ms integer — `new Date()` accepts either, so this is typed
    // loosely rather than assuming one shape.
    date: string | number;
    status: 'attended' | 'missed' | null;
    note: string | null;
    source: 'schedule' | 'manual' | 'seed';
    created_at: string;
  }

  // Index 0 = Monday (ISO weekday 1) .. index 6 = Sunday (ISO weekday 7).
  const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  // How far back the dot strip reaches — a glance-length recent history,
  // not a full ledger (that's what the "slim from ledger to pulse" rework
  // replaces).
  const STRIP_LENGTH = 14;

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let sessions = $state<ClassSession[]>([]);
  let meetingDays = $state<number[] | null>(meetingDaysInitial);
  let marking = $state(false);
  let noteOpenId = $state<string | null>(null);
  let noteDraft = $state('');
  let noteSaving = $state(false);

  let editingDays = $state(false);
  let dayDraft = $state<Set<number>>(new Set());
  let savingDays = $state(false);

  let addingOpen = $state(false);
  let addDate = $state(new Date().toISOString().slice(0, 10));
  let addSaving = $state(false);
  let addError = $state<string | null>(null);

  async function loadSessions() {
    loading = true;
    loadError = null;
    try {
      const from = new Date(Date.now() - 60 * 86400000).toISOString();
      const to = new Date(Date.now() + 14 * 86400000).toISOString();
      const result = await apiFetch<ClassSession[]>(`/api/v1/courses/${courseId}/class-sessions?from=${from}&to=${to}&limit=200`);
      if (!result.ok) {
        // A non-ok response always shows this fixed message (ignoring
        // whatever the server said); only a true network failure shows its
        // own message — matches the pre-apiFetch behavior here.
        loadError = result.reason === 'network' ? result.error : 'Could not load attendance.';
        return;
      }
      sessions = result.data;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void loadSessions();
  });

  const totalCount = $derived(sessions.length);
  const markedCount = $derived(sessions.filter((s) => s.status !== null).length);
  const attendedCount = $derived(sessions.filter((s) => s.status === 'attended').length);
  const missedCount = $derived(sessions.filter((s) => s.status === 'missed').length);
  const percent = $derived(
    attendedCount + missedCount > 0 ? Math.round((attendedCount / (attendedCount + missedCount)) * 100) : null,
  );

  function endOfToday(): number {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }
  function startOfToday(): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // The single row worth a student's attention right now: today's session
  // if it's still unmarked, otherwise the most recent past unmarked one.
  // `sessions` comes back ordered desc(date) (services/classSessions.ts), so
  // the first past-or-today match while scanning in that order is already
  // the most recent one — no separate sort needed. A future manually-added
  // makeup class is deliberately excluded here; it isn't due yet.
  const actionable = $derived.by(() => {
    const todayEnd = endOfToday();
    const todayStart = startOfToday();
    const today = sessions.find((s) => {
      const t = new Date(s.date).getTime();
      return s.status === null && t >= todayStart && t <= todayEnd;
    });
    if (today) return today;
    return sessions.find((s) => s.status === null && new Date(s.date).getTime() < todayStart) ?? null;
  });

  const isActionablePastDue = $derived(
    actionable !== null && new Date(actionable.date).getTime() < startOfToday(),
  );

  // Oldest-to-newest reading order (left→right), most recent STRIP_LENGTH
  // sessions — display-only, no per-dot editing (the actionable row above
  // is the only write surface left; see the rework's plan comment).
  const dotStrip = $derived([...sessions.slice(0, STRIP_LENGTH)].reverse());

  function dotTitle(s: ClassSession): string {
    const label = formatShortDate(s.date);
    const status = s.status === 'attended' ? 'Attended' : s.status === 'missed' ? 'Missed' : 'Unmarked';
    return `${label} — ${status}`;
  }

  async function markStatus(session: ClassSession, status: 'attended' | 'missed') {
    marking = true;
    const prev = session.status;
    sessions = sessions.map((s) => (s.id === session.id ? { ...s, status } : s));
    try {
      // Either failure mode (non-ok response or the request never landing)
      // reverts identically, so there's nothing left for a catch to do.
      const result = await apiFetch(`/api/v1/class-sessions/${session.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Studyus-Analytics-Surface': '/standing',
        },
        body: JSON.stringify({ status }),
      });
      if (!result.ok) {
        sessions = sessions.map((s) => (s.id === session.id ? { ...s, status: prev } : s));
      } else {
        if (noteOpenId === session.id) noteOpenId = null;
        // Backend two-way syncs this session's linked attend_class task
        // (see classSessions.ts) — refetch so TasksCard picks up the flip.
        await refetchTasks();
      }
    } finally {
      marking = false;
    }
  }

  function toggleNoteEditor(session: ClassSession) {
    if (noteOpenId === session.id) {
      noteOpenId = null;
      return;
    }
    noteOpenId = session.id;
    noteDraft = session.note ?? '';
  }

  // Note-only PATCH (no `status` key at all) — the server only touches the
  // attend_class task sync when `status` is present in the body, so this
  // never disturbs a session's mark either way.
  async function saveNote(session: ClassSession) {
    noteSaving = true;
    try {
      const trimmed = noteDraft.trim();
      const result = await apiFetch<ClassSession>(`/api/v1/class-sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: trimmed || null }),
      });
      if (result.ok) {
        sessions = sessions.map((s) => (s.id === session.id ? { ...s, note: result.data.note } : s));
        noteOpenId = null;
      }
    } finally {
      noteSaving = false;
    }
  }

  function openDayEditor() {
    dayDraft = new Set(meetingDays ?? []);
    editingDays = true;
  }
  function toggleDay(day: number) {
    const next = new Set(dayDraft);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    dayDraft = next;
  }
  async function saveMeetingDays() {
    savingDays = true;
    try {
      const days = [...dayDraft].sort((a, b) => a - b);
      const result = await apiFetch<{ meeting_days: number[] | null }>(`/api/v1/courses/${courseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_days: days.length ? days : null }),
      });
      if (result.ok) {
        meetingDays = result.data.meeting_days ?? (days.length ? days : null);
        editingDays = false;
        await loadSessions();
      }
    } finally {
      savingDays = false;
    }
  }

  async function submitAddClass(e: Event) {
    e.preventDefault();
    if (!addDate) return;
    addSaving = true;
    addError = null;
    try {
      const result = await apiFetch<ClassSession>(
        `/api/v1/courses/${courseId}/class-sessions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: new Date(`${addDate}T12:00:00`).toISOString() }) },
        'Could not add class.',
        'Network error.',
      );
      if (!result.ok) {
        addError = result.error;
        return;
      }
      sessions = [result.data, ...sessions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      addingOpen = false;
      addDate = new Date().toISOString().slice(0, 10);
    } finally {
      addSaving = false;
    }
  }
</script>

<section class="card attendance-card">
  <div class="card-head">
    <h2 class="card-title">Attendance</h2>
    {#if totalCount > 0}
      <span class="stat">
        <span class="num pct">{percent !== null ? `${percent}%` : '—'}</span>
        <span class="caption">{markedCount} of {totalCount} marked</span>
      </span>
    {/if}
  </div>

  {#if loading}
    <div class="skeleton">
      {#each [0, 1, 2, 3] as _}
        <div class="skeleton-row"></div>
      {/each}
    </div>
  {:else if loadError}
    <p class="error">{loadError}</p>
  {:else if meetingDays === null && !editingDays}
    <div class="setup">
      <p class="setup-prompt">When does this class meet?</p>
      <div class="day-chips">
        {#each WEEKDAY_LABELS as label, i}
          {@const day = i + 1}
          <button
            type="button"
            class="chip day-chip"
            aria-pressed={dayDraft.has(day)}
            onclick={() => toggleDay(day)}
          >{label}</button>
        {/each}
      </div>
      <button type="button" class="btn btn-primary save-days-btn" disabled={savingDays || dayDraft.size === 0} onclick={saveMeetingDays}>
        {savingDays ? 'Saving…' : 'Save schedule'}
      </button>
    </div>
  {:else if editingDays}
    <div class="setup">
      <p class="setup-prompt">Which days does this class meet?</p>
      <div class="day-chips">
        {#each WEEKDAY_LABELS as label, i}
          {@const day = i + 1}
          <button
            type="button"
            class="chip day-chip"
            aria-pressed={dayDraft.has(day)}
            onclick={() => toggleDay(day)}
          >{label}</button>
        {/each}
      </div>
      <div class="edit-actions">
        <button type="button" class="btn btn-primary" disabled={savingDays} onclick={saveMeetingDays}>
          {savingDays ? 'Saving…' : 'Save'}
        </button>
        <button type="button" class="btn btn-secondary" disabled={savingDays} onclick={() => (editingDays = false)}>Cancel</button>
      </div>
    </div>
  {:else if sessions.length === 0}
    <p class="empty">No classes scheduled yet.</p>
  {:else}
    {#if actionable}
      <!-- `current` is a real const (unlike the $derived `actionable` above),
           so its non-null narrowing actually persists into the onclick
           closures below — a direct `actionable` reference wouldn't. -->
      {@const current = actionable}
      {@const row = formatWeekdayAndDate(current.date)}
      <div class="actionable" class:nudge={isActionablePastDue}>
        <div class="actionable-top">
          <span class="row-date num">
            <span class="row-weekday">{row.weekday}</span>
            <span class="row-day">{row.date}</span>
          </span>
          <div class="one-tap" role="group" aria-label={`Attendance for ${row.weekday} ${row.date}`}>
            <button type="button" class="btn btn-primary one-tap-btn" disabled={marking} onclick={() => markStatus(current, 'attended')}>
              Attended
            </button>
            <button type="button" class="btn btn-secondary one-tap-btn" disabled={marking} onclick={() => markStatus(current, 'missed')}>
              Missed
            </button>
          </div>
        </div>
        <button type="button" class="note-toggle" onclick={() => toggleNoteEditor(current)}>
          {noteOpenId === current.id ? 'Hide note' : current.note ? 'Edit note' : '+ Note'}
        </button>
        {#if noteOpenId === current.id}
          <div class="note-editor">
            <textarea rows="2" bind:value={noteDraft} placeholder="Add a note (optional)" disabled={noteSaving}></textarea>
            <div class="note-actions">
              <button type="button" class="btn btn-secondary" disabled={noteSaving} onclick={() => (noteOpenId = null)}>Cancel</button>
              <button type="button" class="btn btn-primary" disabled={noteSaving} onclick={() => saveNote(current)}>
                {noteSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        {/if}
      </div>
    {:else}
      <p class="all-set">All sessions marked — nice work.</p>
    {/if}

    <div class="dot-strip" role="list" aria-label="Recent attendance">
      {#each dotStrip as s (s.id)}
        <span
          class="hdot"
          class:hdot-ok={s.status === 'attended'}
          class:hdot-danger={s.status === 'missed'}
          role="listitem"
          title={dotTitle(s)}
        ></span>
      {/each}
    </div>
  {/if}

  {#if !loading && !loadError && meetingDays !== null && !editingDays}
    <div class="card-footer">
      <div class="schedule-row">
        <span class="schedule-chips">
          {#each meetingDays as day}
            <span class="chip pattern-chip">{WEEKDAY_LABELS[day - 1]}</span>
          {/each}
        </span>
        <button type="button" class="link-btn" onclick={openDayEditor}>Edit</button>
      </div>

      {#if addingOpen}
        <form class="add-form" onsubmit={submitAddClass}>
          <input type="date" bind:value={addDate} disabled={addSaving} />
          <button type="submit" class="btn btn-primary" disabled={addSaving}>{addSaving ? 'Adding…' : 'Add'}</button>
          <button type="button" class="btn btn-secondary" disabled={addSaving} onclick={() => (addingOpen = false)}>Cancel</button>
        </form>
        {#if addError}<p class="error">{addError}</p>{/if}
      {:else}
        <button type="button" class="link-btn add-class-btn" onclick={() => (addingOpen = true)}>+ Add class</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .attendance-card { display: flex; flex-direction: column; }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
    flex-shrink: 0;
  }
  .pct { font-size: 20px; font-weight: 620; line-height: 1.1; }
  .caption { font-size: 11px; color: var(--muted); margin-top: 1px; white-space: nowrap; }

  .error { color: var(--danger); font-size: 13px; }

  .skeleton { display: flex; flex-direction: column; gap: var(--space-2); }
  .skeleton-row {
    height: 30px;
    border-radius: var(--radius-sm);
    background: var(--hairline);
    opacity: 0.6;
  }

  .setup { display: flex; flex-direction: column; gap: var(--space-3); align-items: flex-start; }
  .setup-prompt { font-size: 13.5px; color: var(--text); margin: 0; }
  /* wrap is load-bearing at 320px viewports: 7 × 40px chips + gaps (~316px)
     exceed the ~240px card interior there — two rows beat clipped chips. */
  .day-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .day-chip { padding: 6px 0; width: 32px; text-align: center; font-size: 12.5px; }
  .save-days-btn { margin-top: 2px; }
  .edit-actions { display: flex; gap: 8px; }

  /* ---------- Actionable row (the one session worth marking now) ---------- */

  .actionable {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-2) 8px;
    border-radius: var(--radius-sm);
  }
  .actionable.nudge {
    background: var(--warn-soft);
  }

  .actionable-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
  }

  .row-date { display: flex; align-items: baseline; gap: 6px; font-size: 13px; flex-shrink: 0; }
  .row-weekday { color: var(--muted); }
  .row-day { color: var(--text); }

  .one-tap {
    display: flex;
    gap: 6px;
    min-width: 0;
  }
  /* Slimmer than the shared .btn recipe — this pair has to sit comfortably
     next to a date label in a ~300px rail card, and two full-padding .btns
     would fight it for room at any container width. */
  .one-tap-btn {
    padding: 5px 10px;
    font-size: 12px;
    min-width: 0;
  }

  .note-toggle {
    align-self: flex-start;
    background: none;
    color: var(--accent);
    font-size: 12px;
    font-weight: 550;
  }
  .note-toggle:hover { text-decoration: underline; }

  .note-editor { display: flex; flex-direction: column; gap: 6px; }
  .note-editor textarea {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    resize: vertical;
  }
  .note-actions { display: flex; justify-content: flex-end; gap: 6px; }

  .all-set {
    font-size: 13px;
    color: var(--muted);
    padding: 4px 8px;
  }

  /* ---------- Dot strip (display-only recent history) ---------- */

  .dot-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px solid var(--hairline);
  }
  .hdot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--border);
    background: none;
    flex-shrink: 0;
  }
  .hdot-ok { background: var(--good-ink); border-color: var(--good-ink); }
  .hdot-danger { background: var(--danger-ink); border-color: var(--danger-ink); }

  .card-footer {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .schedule-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .schedule-chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .pattern-chip { padding: 2px 7px; font-size: 11px; color: var(--muted); }

  .link-btn {
    background: none;
    color: var(--accent);
    font-size: 12.5px;
    font-weight: 550;
    padding: 2px 0;
  }
  .link-btn:hover { text-decoration: underline; }
  .add-class-btn { align-self: flex-start; }

  .add-form { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .add-form input[type='date'] {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12.5px;
    background: var(--surface);
    color: var(--text);
  }

  /* PHONE — main content-box ≤ 480px: bigger touch targets for the day
     chips and the actionable row's one-tap buttons. 7 chips × 40px + 6 × 6px
     gaps = 316px, well inside a ~358px phone content-box. */
  @container (max-width: 480px) {
    .day-chip { width: 40px; padding: 9px 0; font-size: 13px; }
    .one-tap-btn { min-height: 40px; padding: 8px 12px; font-size: 13px; }
    .actionable-top { flex-wrap: wrap; }
  }
</style>
