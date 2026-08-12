<script lang="ts">
  // Attendance lives as pre-generated class_sessions rows (one per meeting
  // day) whose status gets updated in place — not events appended by a
  // button click. See docs/api.md "Class sessions" for the contract.
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
  const ROW_LIMIT = 8;

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let sessions = $state<ClassSession[]>([]);
  let meetingDays = $state<number[] | null>(meetingDaysInitial);
  let showAll = $state(false);
  let savingIds = $state<Set<string>>(new Set());

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
      const res = await fetch(`/api/v1/courses/${courseId}/class-sessions?from=${from}&to=${to}&limit=200`);
      if (!res.ok) {
        loadError = 'Could not load attendance.';
        return;
      }
      const json = await res.json();
      sessions = json.data;
    } catch {
      loadError = 'Network error, please try again.';
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
  const visibleSessions = $derived(showAll ? sessions : sessions.slice(0, ROW_LIMIT));

  function endOfToday(): number {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }
  // The card's nudge toward action: unmarked sessions that have already
  // happened (today included) are the ones worth a student's attention.
  function isNudged(s: ClassSession): boolean {
    return s.status === null && new Date(s.date).getTime() <= endOfToday();
  }

  function formatRow(dateIso: string): { weekday: string; date: string } {
    const d = new Date(dateIso);
    return {
      weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
      date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    };
  }

  async function setStatus(session: ClassSession, status: 'attended' | 'missed' | null) {
    if (session.status === status) return;
    const prev = session.status;
    savingIds = new Set(savingIds).add(session.id);
    sessions = sessions.map((s) => (s.id === session.id ? { ...s, status } : s));
    try {
      const res = await fetch(`/api/v1/class-sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        sessions = sessions.map((s) => (s.id === session.id ? { ...s, status: prev } : s));
      }
    } catch {
      sessions = sessions.map((s) => (s.id === session.id ? { ...s, status: prev } : s));
    } finally {
      const next = new Set(savingIds);
      next.delete(session.id);
      savingIds = next;
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
      const res = await fetch(`/api/v1/courses/${courseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_days: days.length ? days : null }),
      });
      if (res.ok) {
        const updated = (await res.json()).data;
        meetingDays = updated.meeting_days ?? (days.length ? days : null);
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
      const res = await fetch(`/api/v1/courses/${courseId}/class-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: new Date(`${addDate}T12:00:00`).toISOString() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        addError = json?.error?.message ?? 'Could not add class.';
        return;
      }
      sessions = [json.data, ...sessions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      addingOpen = false;
      addDate = new Date().toISOString().slice(0, 10);
    } catch {
      addError = 'Network error.';
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
    <ul class="session-list">
      {#each visibleSessions as s (s.id)}
        {@const row = formatRow(s.date)}
        <li class:nudge={isNudged(s)}>
          <span class="row-date num">
            <span class="row-weekday">{row.weekday}</span>
            <span class="row-day">{row.date}</span>
          </span>
          <div class="tri" role="group" aria-label={`Attendance for ${row.weekday} ${row.date}`}>
            <button
              type="button"
              class="tri-btn tri-ok"
              class:active={s.status === 'attended'}
              disabled={savingIds.has(s.id)}
              title="Attended"
              aria-label="Mark attended"
              onclick={() => setStatus(s, 'attended')}
            >✓</button>
            <button
              type="button"
              class="tri-btn tri-unset"
              class:active={s.status === null}
              disabled={savingIds.has(s.id)}
              title="Unmarked"
              aria-label="Mark unmarked"
              onclick={() => setStatus(s, null)}
            >–</button>
            <button
              type="button"
              class="tri-btn tri-danger"
              class:active={s.status === 'missed'}
              disabled={savingIds.has(s.id)}
              title="Missed"
              aria-label="Mark missed"
              onclick={() => setStatus(s, 'missed')}
            >✗</button>
          </div>
        </li>
      {/each}
    </ul>
    {#if sessions.length > ROW_LIMIT}
      <button type="button" class="show-all-btn" onclick={() => (showAll = !showAll)}>
        {showAll ? 'Show fewer' : `Show all (${sessions.length})`}
      </button>
    {/if}
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
  .day-chips { display: flex; gap: 6px; }
  .day-chip { padding: 6px 0; width: 32px; text-align: center; font-size: 12.5px; }
  .save-days-btn { margin-top: 2px; }
  .edit-actions { display: flex; gap: 8px; }

  .session-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .session-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) 4px;
    border-bottom: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }
  .session-list li:last-child { border-bottom: none; }
  .session-list li.nudge {
    background: var(--warn-soft);
    margin: 0 -4px;
    padding: var(--space-2) 8px;
  }

  .row-date { display: flex; align-items: baseline; gap: 6px; font-size: 13px; }
  .row-weekday { color: var(--muted); }
  .row-day { color: var(--text); }

  .tri {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex-shrink: 0;
  }
  .tri-btn {
    width: 26px;
    height: 24px;
    display: grid;
    place-items: center;
    font-size: 12px;
    line-height: 1;
    color: var(--muted);
    border-right: 1px solid var(--border);
    transition: var(--motion-fast) var(--ease);
  }
  .tri-btn:last-child { border-right: none; }
  .tri-btn:hover:not(:disabled) { background: var(--hover); }
  .tri-btn:disabled { opacity: 0.5; cursor: default; }
  .tri-ok.active { background: var(--good-soft); color: var(--good-ink); }
  .tri-danger.active { background: var(--danger-soft); color: var(--danger-ink); }
  .tri-unset.active { background: var(--hairline); color: var(--muted); }

  .show-all-btn {
    background: none;
    color: var(--accent);
    padding: var(--space-2) 4px 0;
    font-size: 12.5px;
    font-weight: 550;
    text-align: left;
  }
  .show-all-btn:hover { text-decoration: underline; }

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
</style>
