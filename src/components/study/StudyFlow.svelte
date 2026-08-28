<script lang="ts">
  // The /study "door": pick course → duration → type → timer → completion.
  // Session lifecycle goes through the sessions API (POST /sessions, PATCH
  // /sessions/:id/complete). KC outcomes, including optional ratings, are
  // one atomic terminal command; discard has its own evidence-free route.
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/apiClient';
  import { captureBehavioralEvent } from '../../lib/analytics/client';
  import { createPracticeAnalytics, installPageExitAbandonment } from '../../lib/analytics/learning';
  import { EVENT_TYPES, type EventType } from '../../lib/schemas/events';

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
    ritualId?: string | null;
  }
  // v1.9: session-shape ritual picked at session start — steps render as a
  // guidance rail during the running step (not enforced gates).
  interface RitualStep {
    kind: 'game' | 'warmup' | 'retrieval' | 'new_material' | 'reflect' | 'break';
    label?: string;
    minutes?: number;
  }
  interface RitualOption {
    id: string;
    name: string;
    steps: RitualStep[];
  }
  interface Props {
    courses: Course[];
    openSession: OpenSession | null;
    // Set from a course's Practice tab: skips the course-pick step and pins
    // the session to that course (still falls back to 'course' if the id
    // isn't found among `courses`, e.g. a stale prop).
    preselectedCourseId?: string | null;
    // Active session_shape/both rituals available to pick at session start.
    // Empty (the default) skips the ritual-picker step entirely.
    rituals?: RitualOption[];
  }
  const { courses, openSession, preselectedCourseId = null, rituals = [] }: Props = $props();
  const preselected = preselectedCourseId ? courses.find((c) => c.id === preselectedCourseId) ?? null : null;

  const RITUAL_STEP_LABELS: Record<RitualStep['kind'], string> = {
    game: 'Game',
    warmup: 'Warm-up',
    retrieval: 'Retrieval practice',
    new_material: 'New material',
    reflect: 'Reflect',
    break: 'Break',
  };

  type StudyType = { label: string; value: 'practice_done' | 'reading_done' | 'retrieval_practice' | 'video_watched' | 'quick_quiz' };
  const STUDY_TYPES: StudyType[] = [
    { label: 'Practice problems', value: 'practice_done' },
    { label: 'Reading', value: 'reading_done' },
    { label: 'Review — retrieval', value: 'retrieval_practice' },
    { label: 'Watch video', value: 'video_watched' },
    { label: 'Quick quiz', value: 'quick_quiz' },
  ];

  type Step = 'resume' | 'course' | 'duration' | 'type' | 'ritual' | 'running' | 'complete' | 'done';
  let step = $state<Step>(openSession ? 'resume' : preselected ? 'duration' : 'course');

  let selectedCourse = $state<Course | null>(preselected);
  let plannedMinutes = $state(25);
  let customMinutes = $state('');
  let intendedType = $state<StudyType['value'] | null>(null);
  let selectedRitual = $state<RitualOption | null>(null);

  let sessionId = $state<string | null>(null);
  let sessionStartedAt = $state<number>(0);
  let sessionPlannedMinutes = $state<number>(25);

  let paused = $state(false);
  let elapsedSeconds = $state(0);
  let timerHandle: ReturnType<typeof setInterval> | null = null;

  let discarding = $state(false);
  let resumeVisitStartedAt = $state(0);
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
  const practiceAnalytics = createPracticeAnalytics(captureBehavioralEvent);

  function maintainedEventType(value: string): value is EventType {
    return EVENT_TYPES.includes(value as EventType) && value !== 'tutor_session';
  }

  onMount(() => {
    resumeVisitStartedAt = Date.now();
    const cleanupAbandonment = installPageExitAbandonment(practiceAnalytics.abandon);
    return () => {
      stopTimer();
      cleanupAbandonment();
    };
  });

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
    selectedRitual = rituals.find((r) => r.id === openSession.ritualId) ?? null;
    sessionId = openSession.id;
    sessionPlannedMinutes = openSession.plannedMinutes ?? 25;
    sessionStartedAt = openSession.startedAt;
    elapsedSeconds = Math.floor((Date.now() - openSession.startedAt) / 1000);
    step = 'running';
    startTimer();
    if (selectedCourse && maintainedEventType(openSession.intendedEventType)) {
      practiceAnalytics.start({
        course_id: selectedCourse.id,
        intended_event_type: openSession.intendedEventType,
        ...(selectedRitual ? { ritual_id: selectedRitual.id } : {}),
      });
    }
  }

  async function discardSession() {
    if (!openSession) return;
    discarding = true;
    error = null;
    try {
      const result = await apiFetch(`/api/v1/sessions/${openSession.id}/discard`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_at: new Date().toISOString() }),
      }, 'Failed to discard session');
      if (!result.ok) {
        error = result.error;
        return;
      }
      practiceAnalytics.abandonOnDiscard(resumeVisitStartedAt || Date.now());
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

  function pickType(type: StudyType['value']) {
    intendedType = type;
    if (type === 'quick_quiz') {
      const params = new URLSearchParams();
      if (selectedCourse) params.set('course', selectedCourse.id);
      params.set('minutes', String(plannedMinutes));
      window.location.href = `/study/quiz?${params.toString()}`;
      return;
    }

    // Only worth asking when there's something to pick — skip straight to
    // starting the session otherwise.
    if (rituals.length > 0) {
      step = 'ritual';
      return;
    }
    beginSession(null);
  }

  function pickRitual(ritual: RitualOption | null) {
    selectedRitual = ritual;
    beginSession(ritual);
  }

  async function beginSession(ritual: RitualOption | null) {
    error = null;
    const result = await apiFetch<{ id: string }>(
      '/api/v1/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id: selectedCourse?.id,
          intended_event_type: intendedType,
          planned_minutes: plannedMinutes,
          ritual_id: ritual?.id,
        }),
      },
      'Failed to start session',
    );
    if (!result.ok) {
      error = result.error;
      return;
    }
    sessionId = result.data.id;
    sessionPlannedMinutes = plannedMinutes;
    sessionStartedAt = Date.now();
    elapsedSeconds = 0;
    step = 'running';
    startTimer();
    if (selectedCourse && intendedType && intendedType !== 'quick_quiz') {
      practiceAnalytics.start({
        course_id: selectedCourse.id,
        intended_event_type: intendedType,
        ...(ritual ? { ritual_id: ritual.id } : {}),
        started_at: sessionStartedAt,
      });
    }
  }

  async function endSession() {
    stopTimer();
    practiceAnalytics.enterStage('reflection');
    branches = [];
    touchedKcIds = new Set();
    selfRatings = {};
    if (selectedCourse) {
      // Non-fatal on failure (either branch) — completion screen just shows
      // no KC checklist.
      const result = await apiFetch<{ branches: Branch[] }>(`/api/v1/courses/${selectedCourse.slug}`);
      if (result.ok) branches = result.data.branches ?? [];
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
      const completion = await apiFetch<{
        events_appended: unknown[];
        mastery_deltas: ResultView['masteryDeltas'];
      }>(
        `/api/v1/sessions/${sessionId}/complete`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kc_outcomes: kcIds.map((kcId) => ({
              kc_id: kcId,
              ...(selfRatings[kcId] ? { self_rating: Number(selfRatings[kcId]) } : {}),
            })),
            reflection: reflection.trim() || undefined,
            ended_at: new Date().toISOString(),
          }),
        },
        'Failed to complete session',
      );
      if (!completion.ok) {
        error = completion.error;
        return;
      }

      practiceAnalytics.terminal();
      result = {
        eventsCreated: completion.data.events_appended?.length ?? 0,
        masteryDeltas: completion.data.mastery_deltas ?? [],
      };
      step = 'done';
    } finally {
      completing = false;
    }
  }

  // The retrieval step's rail link points at the practice page's Quick
  // Quiz section (id="quick-quiz" in PracticePanel.svelte). When the
  // session is already running from that page, a normal href there is a
  // dead reload — scroll to the section instead. Anywhere else (e.g. the
  // general /study door), keep the full URL so the link still goes
  // somewhere.
  function onPracticePageFor(slug: string): boolean {
    return typeof window !== 'undefined' && window.location.pathname === `/courses/${slug}/practice`;
  }

  function goToQuickQuiz(e: MouseEvent, slug: string) {
    if (!onPracticePageFor(slug)) return;
    e.preventDefault();
    document.getElementById('quick-quiz')?.scrollIntoView({ behavior: 'smooth' });
  }

  function startOver() {
    sessionId = null;
    selectedCourse = preselected;
    intendedType = null;
    selectedRitual = null;
    elapsedSeconds = 0;
    reflection = '';
    result = null;
    step = preselected ? 'duration' : 'course';
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

  {#if step === 'ritual'}
    <div class="card">
      <h2>Shape this session?</h2>
      <p class="context">Optional — a step rail to guide (not gate) how you move through the session.</p>
      <div class="actions">
        {#each rituals as r (r.id)}
          <button type="button" class="option" onclick={() => pickRitual(r)}>{r.name}</button>
        {/each}
      </div>
      <button type="button" class="link" onclick={() => pickRitual(null)}>Skip — just study</button>
    </div>
  {/if}

  {#if step === 'running'}
    <div class="card timer-card">
      <p class="context">
        {selectedCourse ? `${selectedCourse.code} — ${selectedCourse.title}` : 'General study'}
        {#if intendedType}· {STUDY_TYPES.find((t) => t.value === intendedType)?.label}{/if}
      </p>
      <div class="timer">{formatTime(remainingSeconds())}</div>
      {#if selectedRitual && selectedRitual.steps.length > 0}
        <div class="ritual-rail">
          <p class="rail-name">{selectedRitual.name}</p>
          <ol class="rail-steps">
            {#each selectedRitual.steps as s, i (i)}
              {@const totalSeconds = sessionPlannedMinutes * 60}
              {@const stepShare = totalSeconds / selectedRitual.steps.length}
              {@const current = Math.min(selectedRitual.steps.length - 1, Math.floor(elapsedSeconds / Math.max(stepShare, 1))) === i}
              <li class="rail-step" class:current>
                <span class="rail-kind">{RITUAL_STEP_LABELS[s.kind]}</span>
                {#if s.label}<span class="rail-detail">{s.label}</span>{/if}
                {#if s.minutes}<span class="rail-minutes">{s.minutes}m</span>{/if}
                {#if s.kind === 'retrieval' && selectedCourse}
                  <a
                    class="rail-link"
                    href={onPracticePageFor(selectedCourse.slug) ? '#quick-quiz' : `/courses/${selectedCourse.slug}/practice`}
                    onclick={(e) => goToQuickQuiz(e, selectedCourse!.slug)}
                  >Quick quiz →</a>
                {:else if s.kind === 'new_material' && selectedCourse}
                  <a class="rail-link" href={`/courses/${selectedCourse.slug}`}>Course home →</a>
                {:else if s.kind === 'game' && selectedCourse}
                  <a class="rail-link" href={`/courses/${selectedCourse.slug}/play`}>Play →</a>
                {:else if s.kind === 'reflect'}
                  <span class="rail-note">You'll reflect when you finish this session.</span>
                {/if}
              </li>
            {/each}
          </ol>
        </div>
      {/if}
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
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .card h2 { margin: 0; font-size: 1.15rem; }
  .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  .option, .primary, .ghost {
    border-radius: var(--radius-sm);
    padding: 0.55rem 1rem;
    font-size: 0.92rem;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--hover);
  }
  .primary { background: var(--accent); color: var(--surface); border: none; }
  .primary:disabled { opacity: 0.6; cursor: default; }
  .ghost { background: none; }
  .link { background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; text-align: left; font-size: 0.88rem; }
  .course-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr)); gap: 0.7rem; }
  .course-card {
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.8rem;
    background: var(--bg);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .course-card:hover { background: var(--hover); }
  .code { font-weight: 600; font-size: 0.85rem; }
  .title { font-size: 0.82rem; color: var(--muted); }
  .mastery-bar { height: 5px; background: var(--border); border-radius: 999px; overflow: hidden; }
  .mastery-fill { height: 100%; background: var(--accent); }
  .mastery-label { font-size: 0.75rem; color: var(--muted); }
  .custom-duration { display: flex; gap: 0.5rem; align-items: center; }
  .custom-duration input { padding: 0.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm); width: 140px; }
  .timer-card { align-items: center; text-align: center; }
  .context { color: var(--muted); font-size: 0.9rem; margin: 0; }
  .timer { font-size: 3rem; font-weight: 600; font-variant-numeric: tabular-nums; }
  /* Dense, repeated (one per branch in the wrap-up checklist) — sans
     escape hatch. */
  .branch-group h3 { font-size: 0.85rem; color: var(--muted); margin: 0.6rem 0 0.4rem 0; font-family: var(--font-title, var(--font-display)); }
  .kc-row { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.25rem 0; }
  .kc-check { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
  .kc-row select { padding: 0.3rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border); font-size: 0.8rem; }
  .reflection { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.88rem; color: var(--text); }
  .reflection textarea { padding: 0.5rem; border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: inherit; font-size: 0.9rem; }
  .deltas { margin: 0; padding-left: 1.1rem; font-size: 0.88rem; color: var(--text); }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .error { color: var(--danger); font-size: 0.9rem; }

  /* Ritual step rail — a guidance list during 'running', not enforced gates:
     every step is always visible and clickable, 'current' only highlights
     roughly where the elapsed time places you. */
  .ritual-rail { width: 100%; text-align: left; }
  .rail-name { margin: 0 0 0.5rem; font-size: 0.82rem; color: var(--muted); font-weight: 600; }
  .rail-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .rail-step {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
  }
  .rail-step.current { border-color: var(--accent); background: var(--accent-soft); }
  .rail-kind { font-weight: 600; }
  .rail-detail, .rail-note { color: var(--muted); }
  .rail-minutes { color: var(--muted); font-size: 0.78rem; }
  .rail-link { margin-left: auto; color: var(--accent); text-decoration: none; font-weight: 550; }
  .rail-link:hover { text-decoration: underline; }
</style>
