<script lang="ts">
  // The /study "door": pick course → duration → type → timer → completion.
  // Session lifecycle goes through the sessions API (POST /sessions, PATCH
  // /sessions/:id/complete); KC touches beyond what /complete supports
  // (self-ratings) are recorded as extra self_assessment events via the
  // events API — the sessions service only tags the auto-appended event
  // with { session_id }, so a rating needs its own event to land in payload.
  interface Course {
    id: string;
    slug: string;
    code: string;
    title: string;
    mastery: number | null;
    status: string | null;
  }
  interface OpenSession {
    id: string;
    courseId: string | null;
    courseCode: string | null;
    intendedEventType: string;
    plannedMinutes: number | null;
    startedAt: number;
  }
  interface Props {
    courses: Course[];
    openSession: OpenSession | null;
  }
  const { courses, openSession }: Props = $props();

  type StudyType = { label: string; value: 'practice_done' | 'reading_done' | 'retrieval_practice' | 'video_watched' | 'quick_quiz' };
  const STUDY_TYPES: StudyType[] = [
    { label: 'Practice problems', value: 'practice_done' },
    { label: 'Reading', value: 'reading_done' },
    { label: 'Review — retrieval', value: 'retrieval_practice' },
    { label: 'Watch video', value: 'video_watched' },
    { label: 'Quick quiz (AI)', value: 'quick_quiz' },
  ];

  type Step = 'resume' | 'course' | 'duration' | 'type' | 'running' | 'complete' | 'done';
  let step = $state<Step>(openSession ? 'resume' : 'course');

  let selectedCourse = $state<Course | null>(null);
  let plannedMinutes = $state(25);
  let customMinutes = $state('');
  let intendedType = $state<StudyType['value'] | null>(null);

  let sessionId = $state<string | null>(null);
  let sessionStartedAt = $state<number>(0);
  let sessionPlannedMinutes = $state<number>(25);

  let paused = $state(false);
  let elapsedSeconds = $state(0);
  let timerHandle: ReturnType<typeof setInterval> | null = null;

  let discarding = $state(false);
  let error = $state<string | null>(null);

  type Kc = { id: string; name: string };
  type Branch = { id: string; name: string; kcs: Kc[] };
  let branches = $state<Branch[]>([]);
  let touchedKcIds = $state<Set<string>>(new Set());
  let selfRatings = $state<Record<string, string>>({});
  let reflection = $state('');
  let completing = $state(false);

  type ResultView = { eventsCreated: number; masteryDeltas: { kc_id: string; old_mastery: number; new_mastery: number }[] };
  let result = $state<ResultView | null>(null);

  function remainingSeconds(): number {
    return Math.max(0, sessionPlannedMinutes * 60 - elapsedSeconds);
  }

  function startTimer() {
    if (timerHandle) return;
    timerHandle = setInterval(() => {
      if (!paused) {
        elapsedSeconds += 1;
        if (remainingSeconds() <= 0) endSession();
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function resumeSession() {
    if (!openSession) return;
    selectedCourse = courses.find((c) => c.id === openSession.courseId) ?? null;
    sessionId = openSession.id;
    sessionPlannedMinutes = openSession.plannedMinutes ?? 25;
    sessionStartedAt = openSession.startedAt;
    elapsedSeconds = Math.floor((Date.now() - openSession.startedAt) / 1000);
    step = 'running';
    startTimer();
  }

  async function discardSession() {
    if (!openSession) return;
    discarding = true;
    error = null;
    try {
      const res = await fetch(`/api/v1/sessions/${openSession.id}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kc_ids_touched: [], reflection: 'Discarded — not counted.' }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        error = json?.error?.message ?? 'Failed to discard session';
        return;
      }
      step = 'course';
    } finally {
      discarding = false;
    }
  }

  function pickCourse(course: Course | null) {
    selectedCourse = course;
    step = 'duration';
  }

  function pickDuration(minutes: number) {
    plannedMinutes = minutes;
    step = 'type';
  }

  function useCustomMinutes() {
    const n = Number(customMinutes);
    if (n > 0) pickDuration(n);
  }

  async function pickType(type: StudyType['value']) {
    intendedType = type;
    if (type === 'quick_quiz') {
      const params = new URLSearchParams();
      if (selectedCourse) params.set('course', selectedCourse.id);
      params.set('minutes', String(plannedMinutes));
      window.location.href = `/study/quiz?${params.toString()}`;
      return;
    }

    error = null;
    try {
      const res = await fetch('/api/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id: selectedCourse?.id,
          intended_event_type: type,
          planned_minutes: plannedMinutes,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        error = json?.error?.message ?? 'Failed to start session';
        return;
      }
      sessionId = json.data.id;
      sessionPlannedMinutes = plannedMinutes;
      sessionStartedAt = Date.now();
      elapsedSeconds = 0;
      step = 'running';
      startTimer();
    } catch {
      error = 'Network error, please try again.';
    }
  }

  async function endSession() {
    stopTimer();
    branches = [];
    touchedKcIds = new Set();
    selfRatings = {};
    if (selectedCourse) {
      try {
        const res = await fetch(`/api/v1/courses/${selectedCourse.slug}`);
        const json = await res.json();
        if (res.ok) branches = json.data.branches ?? [];
      } catch {
        // Non-fatal — completion screen just shows no KC checklist.
      }
    }
    step = 'complete';
  }

  function toggleKc(kcId: string, checked: boolean) {
    const next = new Set(touchedKcIds);
    if (checked) next.add(kcId);
    else {
      next.delete(kcId);
      const { [kcId]: _removed, ...rest } = selfRatings;
      selfRatings = rest;
    }
    touchedKcIds = next;
  }

  async function submitCompletion() {
    if (!sessionId) return;
    completing = true;
    error = null;
    try {
      const kcIds = [...touchedKcIds];
      const res = await fetch(`/api/v1/sessions/${sessionId}/complete`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kc_ids_touched: kcIds,
          reflection: reflection.trim() || undefined,
          ended_at: new Date().toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        error = json?.error?.message ?? 'Failed to complete session';
        return;
      }

      const masteryDeltas: ResultView['masteryDeltas'] = [...(json.data.mastery_deltas ?? [])];
      let eventsCreated = (json.data.events_appended ?? []).length;

      for (const kcId of kcIds) {
        const rating = selfRatings[kcId];
        if (!rating) continue;
        const eventRes = await fetch('/api/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'self_assessment',
            kc_id: kcId,
            course_id: selectedCourse?.id,
            payload: { self_rating: Number(rating) },
          }),
        });
        const eventJson = await eventRes.json();
        if (eventRes.ok) {
          eventsCreated += 1;
          masteryDeltas.push(...(eventJson.data.mastery_deltas ?? []));
        }
      }

      result = { eventsCreated, masteryDeltas };
      step = 'done';
    } finally {
      completing = false;
    }
  }

  function startOver() {
    sessionId = null;
    selectedCourse = null;
    intendedType = null;
    elapsedSeconds = 0;
    reflection = '';
    result = null;
    step = 'course';
  }
</script>

<div class="study-flow">
  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if step === 'resume' && openSession}
    <div class="card">
      <h2>Unfinished session</h2>
      <p>
        You have an open session{openSession.courseCode ? ` for ${openSession.courseCode}` : ''}
        ({openSession.intendedEventType.replace(/_/g, ' ')}), started {new Date(openSession.startedAt).toLocaleString()}.
      </p>
      <div class="actions">
        <button type="button" class="primary" onclick={resumeSession}>Resume</button>
        <button type="button" class="ghost" disabled={discarding} onclick={discardSession}>
          {discarding ? 'Discarding…' : 'Discard'}
        </button>
      </div>
    </div>
  {/if}

  {#if step === 'course'}
    <div class="card">
      <h2>Pick a course</h2>
      <div class="course-grid">
        {#each courses as course (course.id)}
          <button type="button" class="course-card" onclick={() => pickCourse(course)}>
            <span class="code">{course.code}</span>
            <span class="title">{course.title}</span>
            {#if course.mastery !== null}
              <div class="mastery-bar"><div class="mastery-fill" style={`width:${course.mastery}%`}></div></div>
              <span class="mastery-label">{course.mastery}% · {course.status}</span>
            {/if}
          </button>
        {/each}
      </div>
      <button type="button" class="link" onclick={() => pickCourse(null)}>Study without a specific course</button>
    </div>
  {/if}

  {#if step === 'duration'}
    <div class="card">
      <h2>How long?</h2>
      <div class="actions">
        <button type="button" class="option" onclick={() => pickDuration(25)}>25 min</button>
        <button type="button" class="option" onclick={() => pickDuration(50)}>50 min</button>
      </div>
      <div class="custom-duration">
        <input type="number" min="1" placeholder="Custom minutes" bind:value={customMinutes} />
        <button type="button" class="ghost" onclick={useCustomMinutes}>Use</button>
      </div>
    </div>
  {/if}

  {#if step === 'type'}
    <div class="card">
      <h2>What kind of studying?</h2>
      <div class="actions">
        {#each STUDY_TYPES as t (t.value)}
          <button type="button" class="option" onclick={() => pickType(t.value)}>{t.label}</button>
        {/each}
      </div>
    </div>
  {/if}

  {#if step === 'running'}
    <div class="card timer-card">
      <p class="context">
        {selectedCourse ? `${selectedCourse.code} — ${selectedCourse.title}` : 'General study'}
        {#if intendedType}· {STUDY_TYPES.find((t) => t.value === intendedType)?.label}{/if}
      </p>
      <div class="timer">{formatTime(remainingSeconds())}</div>
      <div class="actions">
        <button type="button" class="ghost" onclick={() => (paused = !paused)}>{paused ? 'Resume' : 'Pause'}</button>
        <button type="button" class="primary" onclick={endSession}>End session</button>
      </div>
    </div>
  {/if}

  {#if step === 'complete'}
    <div class="card">
      <h2>Wrap up</h2>
      {#if branches.length > 0}
        <p>Which knowledge components did you touch?</p>
        {#each branches as branch (branch.id)}
          <div class="branch-group">
            <h3>{branch.name}</h3>
            {#each branch.kcs as kc (kc.id)}
              <div class="kc-row">
                <label class="kc-check">
                  <input
                    type="checkbox"
                    checked={touchedKcIds.has(kc.id)}
                    onchange={(e) => toggleKc(kc.id, (e.target as HTMLInputElement).checked)}
                  />
                  {kc.name}
                </label>
                {#if touchedKcIds.has(kc.id)}
                  <select bind:value={selfRatings[kc.id]}>
                    <option value="">No self-rating</option>
                    <option value="1">1 — struggled</option>
                    <option value="2">2</option>
                    <option value="3">3 — okay</option>
                    <option value="4">4</option>
                    <option value="5">5 — nailed it</option>
                  </select>
                {/if}
              </div>
            {/each}
          </div>
        {/each}
      {:else}
        <p class="muted">No knowledge components to pick from for this session.</p>
      {/if}

      <label class="reflection">
        Reflection (optional)
        <textarea bind:value={reflection} rows="3" placeholder="What did you notice about this session?"></textarea>
      </label>

      <button type="button" class="primary" disabled={completing} onclick={submitCompletion}>
        {completing ? 'Saving…' : 'Finish session'}
      </button>
    </div>
  {/if}

  {#if step === 'done' && result}
    <div class="card">
      <h2>Session logged</h2>
      <p>{result.eventsCreated} event{result.eventsCreated === 1 ? '' : 's'} recorded.</p>
      {#if result.masteryDeltas.length > 0}
        <ul class="deltas">
          {#each result.masteryDeltas as d, i (i)}
            <li>Mastery {d.old_mastery}% → {d.new_mastery}%</li>
          {/each}
        </ul>
      {/if}
      <button type="button" class="primary" onclick={startOver}>Start another session</button>
    </div>
  {/if}
</div>

<style>
  .study-flow { max-width: 640px; }
  .card {
    background: white;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .card h2 { margin: 0; font-size: 1.15rem; }
  .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  .option, .primary, .ghost {
    border-radius: 8px;
    padding: 0.55rem 1rem;
    font-size: 0.92rem;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--hover-bg);
  }
  .primary { background: var(--accent); color: white; border: none; }
  .primary:disabled { opacity: 0.6; cursor: default; }
  .ghost { background: none; }
  .link { background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; text-align: left; font-size: 0.88rem; }
  .course-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.7rem; }
  .course-card {
    text-align: left;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.8rem;
    background: var(--bg);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .course-card:hover { background: var(--hover-bg); }
  .code { font-weight: 600; font-size: 0.85rem; }
  .title { font-size: 0.82rem; color: var(--muted); }
  .mastery-bar { height: 5px; background: var(--border); border-radius: 999px; overflow: hidden; }
  .mastery-fill { height: 100%; background: var(--accent); }
  .mastery-label { font-size: 0.75rem; color: var(--muted); }
  .custom-duration { display: flex; gap: 0.5rem; align-items: center; }
  .custom-duration input { padding: 0.5rem; border: 1px solid var(--border); border-radius: 8px; width: 140px; }
  .timer-card { align-items: center; text-align: center; }
  .context { color: var(--muted); font-size: 0.9rem; margin: 0; }
  .timer { font-size: 3rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  .branch-group h3 { font-size: 0.85rem; color: var(--muted); margin: 0.6rem 0 0.4rem 0; }
  .kc-row { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.25rem 0; }
  .kc-check { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
  .kc-row select { padding: 0.3rem 0.5rem; border-radius: 6px; border: 1px solid var(--border); font-size: 0.8rem; }
  .reflection { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.88rem; color: #374151; }
  .reflection textarea { padding: 0.5rem; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; font-size: 0.9rem; }
  .deltas { margin: 0; padding-left: 1.1rem; font-size: 0.88rem; color: #374151; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .error { color: #b91c1c; font-size: 0.9rem; }
</style>
