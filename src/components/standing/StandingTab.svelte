<script lang="ts">
  // Self-contained island for the course page's "Standing" tab. Fetches
  // everything it needs client-side — no server-side props beyond
  // identifying the course. Embedded by the M2B course-area agent.
  interface Props {
    courseId: string;
    courseSlug: string;
  }
  let { courseId, courseSlug }: Props = $props();

  interface Kc { id: string; name: string; mastery: number; status: string }
  interface Branch { id: string; name: string; kcs: Kc[] }
  interface CourseDetail { branches: Branch[] }
  interface Assessment {
    id: string;
    title: string;
    type: string;
    due_date: string | null;
    weight_pct: number | null;
    grade_received: number | null;
    grade_max: number | null;
  }
  interface EventRow {
    id: string;
    type: string;
    ts: string;
    source: 'manual' | 'session' | 'tutor' | 'seed';
    kc_id: string | null;
  }
  interface CalendarItem {
    id: string;
    type: string;
    title: string;
    date: string;
  }

  const EVENT_TYPES = [
    'lecture_attended', 'lecture_missed', 'video_watched', 'reading_done', 'taught_someone',
    'quiz_taken', 'assignment_graded', 'exam_graded', 'self_assessment',
    'practice_done', 'retrieval_practice', 'tutor_session',
  ];

  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let branches = $state<Branch[]>([]);
  let assessments = $state<Assessment[]>([]);
  let weightedGrade = $state<number | null>(null);
  let events = $state<EventRow[]>([]);
  let deadlines = $state<CalendarItem[]>([]);

  let gradeDrafts = $state<Record<string, { received: string; max: string }>>({});
  let gradeSavingId = $state<string | null>(null);
  let gradeFeedback = $state<Record<string, string>>({});
  let attendanceSaving = $state(false);
  let eventTypeDrafts = $state<Record<string, string>>({});
  let eventSavingId = $state<string | null>(null);
  let eventFeedback = $state<Record<string, string>>({});

  async function loadAll() {
    loading = true;
    loadError = null;
    try {
      const [courseRes, assessmentsRes, gradesRes, eventsRes, calendarRes] = await Promise.all([
        fetch(`/api/v1/courses/${courseSlug}`),
        fetch(`/api/v1/courses/${courseId}/assessments`),
        fetch(`/api/v1/grades/summary`),
        fetch(`/api/v1/events?course=${courseId}&limit=50`),
        fetch(
          `/api/v1/calendar?course=${courseId}&from=${new Date().toISOString()}&to=${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()}`,
        ),
      ]);

      if (!courseRes.ok || !assessmentsRes.ok || !gradesRes.ok || !eventsRes.ok || !calendarRes.ok) {
        loadError = 'Could not load standing data.';
        return;
      }

      const course: CourseDetail = (await courseRes.json()).data;
      branches = course.branches;

      assessments = (await assessmentsRes.json()).data;
      gradeDrafts = Object.fromEntries(
        assessments.map((a) => [a.id, { received: a.grade_received?.toString() ?? '', max: a.grade_max?.toString() ?? '' }]),
      );

      const gradesSummary = (await gradesRes.json()).data;
      const mine = gradesSummary.by_course.find((c: { course_id: string }) => c.course_id === courseId);
      weightedGrade = mine?.weighted_grade ?? null;

      events = (await eventsRes.json()).data;
      eventTypeDrafts = Object.fromEntries(events.map((e) => [e.id, e.type]));

      deadlines = (await calendarRes.json()).data;
    } catch {
      loadError = 'Network error, please try again.';
    } finally {
      loading = false;
    }
  }

  loadAll();

  const attendanceEvents = $derived(events.filter((e) => e.type === 'lecture_attended' || e.type === 'lecture_missed'));
  const attendancePct = $derived.by(() => {
    if (attendanceEvents.length === 0) return null;
    const attended = attendanceEvents.filter((e) => e.type === 'lecture_attended').length;
    return Math.round((attended / attendanceEvents.length) * 100);
  });

  async function logAttendance(type: 'lecture_attended' | 'lecture_missed') {
    attendanceSaving = true;
    try {
      const res = await fetch('/api/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, course_id: courseId }),
      });
      if (res.ok) {
        const created = (await res.json()).data;
        events = [{ id: created.id, type: created.type, ts: created.ts, source: created.source, kc_id: created.kc_id }, ...events];
      }
    } finally {
      attendanceSaving = false;
    }
  }

  async function saveGrade(assessmentId: string) {
    const draft = gradeDrafts[assessmentId];
    if (!draft) return;
    gradeSavingId = assessmentId;
    gradeFeedback = { ...gradeFeedback, [assessmentId]: '' };
    try {
      const res = await fetch(`/api/v1/assessments/${assessmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grade_received: draft.received === '' ? null : Number(draft.received),
          grade_max: draft.max === '' ? null : Number(draft.max),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        gradeFeedback = { ...gradeFeedback, [assessmentId]: json?.error?.message ?? 'Save failed' };
        return;
      }
      const updated = json.data;
      assessments = assessments.map((a) =>
        a.id === assessmentId ? { ...a, grade_received: updated.grade_received, grade_max: updated.grade_max } : a,
      );
      const logged = Array.isArray(updated.mastery_deltas) && updated.mastery_deltas.length > 0;
      gradeFeedback = { ...gradeFeedback, [assessmentId]: logged ? 'Saved — logged an event for linked KCs.' : 'Saved.' };
    } catch {
      gradeFeedback = { ...gradeFeedback, [assessmentId]: 'Network error.' };
    } finally {
      gradeSavingId = null;
    }
  }

  async function saveEventType(eventId: string) {
    const nextType = eventTypeDrafts[eventId];
    eventSavingId = eventId;
    eventFeedback = { ...eventFeedback, [eventId]: '' };
    try {
      const res = await fetch(`/api/v1/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: nextType }),
      });
      const json = await res.json();
      if (!res.ok) {
        eventFeedback = { ...eventFeedback, [eventId]: json?.error?.message ?? 'Update failed' };
        return;
      }
      events = events.map((e) => (e.id === eventId ? { ...e, type: json.data.type } : e));
      eventFeedback = { ...eventFeedback, [eventId]: 'Updated.' };
    } catch {
      eventFeedback = { ...eventFeedback, [eventId]: 'Network error.' };
    } finally {
      eventSavingId = null;
    }
  }

  async function deleteEventRow(eventId: string) {
    eventSavingId = eventId;
    try {
      const res = await fetch(`/api/v1/events/${eventId}`, { method: 'DELETE' });
      if (res.ok) {
        events = events.filter((e) => e.id !== eventId);
      }
    } finally {
      eventSavingId = null;
    }
  }

  function branchMastery(branch: Branch): number {
    if (branch.kcs.length === 0) return 0;
    return Math.round(branch.kcs.reduce((sum, k) => sum + k.mastery, 0) / branch.kcs.length);
  }

  function formatDate(iso: string | null): string {
    if (!iso) return 'No due date';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
</script>

{#if loading}
  <p class="muted">Loading standing…</p>
{:else if loadError}
  <p class="error">{loadError}</p>
{:else}
  <section class="block">
    <h2>Weighted grade</h2>
    <p class="big-stat">{weightedGrade !== null ? `${weightedGrade}%` : 'No grades entered yet'}</p>
  </section>

  <section class="block">
    <h2>Assessments</h2>
    <p class="reminder">Entering a grade automatically logs an assessment event for any KCs linked to it.</p>
    {#if assessments.length === 0}
      <p class="muted">No assessments yet.</p>
    {:else}
      <table>
        <thead>
          <tr><th>Title</th><th>Type</th><th>Due</th><th>Weight</th><th>Grade</th><th>Out of</th><th></th></tr>
        </thead>
        <tbody>
          {#each assessments as a}
            <tr>
              <td>{a.title}</td>
              <td class="capitalize">{a.type}</td>
              <td>{formatDate(a.due_date)}</td>
              <td>{a.weight_pct !== null ? `${a.weight_pct}%` : '—'}</td>
              <td><input type="number" min="0" bind:value={gradeDrafts[a.id].received} class="grade-input" /></td>
              <td><input type="number" min="0" bind:value={gradeDrafts[a.id].max} class="grade-input" /></td>
              <td>
                <button type="button" onclick={() => saveGrade(a.id)} disabled={gradeSavingId === a.id}>
                  {gradeSavingId === a.id ? 'Saving…' : 'Save'}
                </button>
              </td>
            </tr>
            {#if gradeFeedback[a.id]}
              <tr class="feedback-row"><td colspan="7">{gradeFeedback[a.id]}</td></tr>
            {/if}
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section class="block">
    <h2>Attendance</h2>
    <p class="big-stat">{attendancePct !== null ? `${attendancePct}% attended` : 'No attendance logged yet'}</p>
    <div class="attendance-buttons">
      <button type="button" onclick={() => logAttendance('lecture_attended')} disabled={attendanceSaving}>Attended</button>
      <button type="button" class="secondary" onclick={() => logAttendance('lecture_missed')} disabled={attendanceSaving}>Missed</button>
    </div>
  </section>

  <section class="block">
    <h2>Mastery by branch</h2>
    {#if branches.length === 0}
      <p class="muted">No branches yet.</p>
    {:else}
      <ul class="branch-list">
        {#each branches as b}
          <li>
            <span>{b.name}</span>
            <div class="bar-track"><div class="bar-fill" style="width: {branchMastery(b)}%"></div></div>
            <span class="branch-pct">{branchMastery(b)}%</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="block">
    <h2>Upcoming deadlines</h2>
    {#if deadlines.length === 0}
      <p class="muted">Nothing due in the next 30 days.</p>
    {:else}
      <ul class="deadline-list">
        {#each deadlines as d}
          <li><span class="deadline-date">{formatDate(d.date)}</span><span>{d.title}</span></li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="block">
    <h2>Recent events</h2>
    {#if events.length === 0}
      <p class="muted">No events logged for this course yet.</p>
    {:else}
      <ul class="event-list">
        {#each events as e}
          <li>
            <span class="event-date">{formatDate(e.ts)}</span>
            {#if e.source === 'manual'}
              <select bind:value={eventTypeDrafts[e.id]} disabled={eventSavingId === e.id}>
                {#each EVENT_TYPES as t}
                  <option value={t}>{t.replace(/_/g, ' ')}</option>
                {/each}
              </select>
              <button type="button" onclick={() => saveEventType(e.id)} disabled={eventSavingId === e.id}>Update</button>
            {:else}
              <span class="event-type">{e.type.replace(/_/g, ' ')}</span>
              <span class="source-tag">{e.source}</span>
            {/if}
            <button type="button" class="danger" onclick={() => deleteEventRow(e.id)} disabled={eventSavingId === e.id}>Delete</button>
            {#if eventFeedback[e.id]}<span class="feedback">{eventFeedback[e.id]}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .block {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.25rem;
  }
  .block h2 { margin: 0 0 0.75rem 0; font-size: 1rem; }
  .big-stat { font-size: 1.5rem; font-weight: 700; margin: 0; }
  .muted { color: #6b7280; font-size: 0.9rem; }
  .error { color: #b91c1c; font-size: 0.9rem; }
  .reminder { color: #6b7280; font-size: 0.82rem; margin: 0 0 1rem 0; }

  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th { text-align: left; padding: 0.4rem 0.5rem; color: #6b7280; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid #e5e7eb; }
  td { padding: 0.5rem; border-bottom: 1px solid #f0f2f5; }
  .capitalize { text-transform: capitalize; }
  .grade-input { width: 4.5rem; padding: 0.3rem 0.4rem; border: 1px solid #e5e7eb; border-radius: 6px; }
  .feedback-row td { color: #15803d; font-size: 0.8rem; padding-top: 0; }

  button {
    background: #3f6fd8;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.4rem 0.75rem;
    font-size: 0.82rem;
    cursor: pointer;
  }
  button.secondary { background: #6b7280; }
  button.danger { background: #b91c1c; }
  button:disabled { opacity: 0.6; cursor: default; }
  .attendance-buttons { display: flex; gap: 0.6rem; margin-top: 0.75rem; }

  .branch-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  .branch-list li { display: flex; align-items: center; gap: 0.75rem; font-size: 0.9rem; }
  .branch-list li span:first-child { min-width: 10rem; }
  .bar-track { flex: 1; height: 0.5rem; background: #f0f2f5; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; background: #3f6fd8; }
  .branch-pct { min-width: 2.5rem; text-align: right; color: #6b7280; }

  .deadline-list, .event-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .deadline-list li { display: flex; gap: 0.75rem; font-size: 0.9rem; border-bottom: 1px solid #f0f2f5; padding-bottom: 0.4rem; }
  .deadline-date { color: #3f6fd8; font-weight: 600; min-width: 5rem; }

  .event-list li { display: flex; align-items: center; gap: 0.6rem; font-size: 0.88rem; flex-wrap: wrap; border-bottom: 1px solid #f0f2f5; padding-bottom: 0.4rem; }
  .event-date { color: #6b7280; min-width: 5rem; }
  .event-type { text-transform: capitalize; }
  .source-tag { color: #9ca3af; font-size: 0.75rem; border: 1px solid #e5e7eb; border-radius: 4px; padding: 0.1rem 0.35rem; }
  select { padding: 0.3rem 0.5rem; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 0.85rem; }
  .feedback { color: #15803d; font-size: 0.8rem; }
</style>
