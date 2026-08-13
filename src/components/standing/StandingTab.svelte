<script lang="ts">
  // Self-contained island for the course page's "Standing" tab. Fetches
  // everything it needs client-side — no server-side props beyond
  // identifying the course. Embedded by the M2B course-area agent.
  //
  // Layout: a hero row (weighted grade) sits above a two-column card grid —
  // a wide main column for things a student *works through* (assessments,
  // mastery), and a narrow rail for things a student *checks in on*
  // (attendance, recent activity). Attendance is no longer logged via
  // events; it's class_sessions rows whose status gets updated in place —
  // see AttendanceCard.
  import AssessmentsCard from './AssessmentsCard.svelte';
  import MasteryCard from './MasteryCard.svelte';
  import DeadlinesCard from './DeadlinesCard.svelte';
  import TasksCard from './TasksCard.svelte';
  import AttendanceCard from './AttendanceCard.svelte';
  import PracticeCard from './PracticeCard.svelte';
  import RecentActivityCard from './RecentActivityCard.svelte';

  interface Props {
    courseId: string;
    courseSlug: string;
  }
  let { courseId, courseSlug }: Props = $props();

  interface Kc { id: string; name: string; mastery: number; status: string }
  interface Branch { id: string; name: string; kcs: Kc[] }
  interface CourseDetail { branches: Branch[]; meeting_days: number[] | null }
  interface Assessment {
    id: string;
    title: string;
    type: string;
    kind: 'official' | 'practice';
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

  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let branches = $state<Branch[]>([]);
  let meetingDays = $state<number[] | null>(null);
  let assessments = $state<Assessment[]>([]);
  let weightedGrade = $state<number | null>(null);
  let events = $state<EventRow[]>([]);
  let deadlines = $state<CalendarItem[]>([]);

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
      meetingDays = course.meeting_days ?? null;

      assessments = (await assessmentsRes.json()).data;

      const gradesSummary = (await gradesRes.json()).data;
      const mine = gradesSummary.by_course.find((c: { course_id: string }) => c.course_id === courseId);
      weightedGrade = mine?.weighted_grade ?? null;

      events = (await eventsRes.json()).data;

      deadlines = (await calendarRes.json()).data;
    } catch {
      loadError = 'Network error, please try again.';
    } finally {
      loading = false;
    }
  }

  loadAll();

  let practiceRefreshToken = $state(0);
  function bumpPracticeRefresh() {
    practiceRefreshToken += 1;
  }

  async function refetchGrade() {
    try {
      const res = await fetch(`/api/v1/grades/summary`);
      if (!res.ok) return;
      const gradesSummary = (await res.json()).data;
      const mine = gradesSummary.by_course.find((c: { course_id: string }) => c.course_id === courseId);
      weightedGrade = mine?.weighted_grade ?? null;
    } catch {
      // best-effort refresh; the saved grade already reflects on the assessment row.
    }
  }
</script>

{#if loading}
  <p class="muted">Loading standing…</p>
{:else if loadError}
  <p class="error">{loadError}</p>
{:else}
  <div class="hero">
    <p class="kicker">Weighted grade</p>
    <p class="figure">{weightedGrade !== null ? `${weightedGrade}%` : '—'}</p>
    {#if weightedGrade === null}<p class="hero-sub">No grades entered yet.</p>{/if}
  </div>

  <div class="grid">
    <div class="main">
      <AssessmentsCard {courseId} {assessments} onGraded={refetchGrade} onPracticeChange={bumpPracticeRefresh} />
      <DeadlinesCard {deadlines} />
      <MasteryCard {branches} />
    </div>

    <aside class="rail">
      <TasksCard {courseId} {courseSlug} />
      <AttendanceCard {courseId} meetingDaysInitial={meetingDays} />
      <PracticeCard {courseId} {courseSlug} refreshToken={practiceRefreshToken} />
      <RecentActivityCard {events} />
    </aside>
  </div>
{/if}

<style>
  .muted { color: var(--muted); font-size: 0.9rem; }
  .error { color: var(--danger); font-size: 0.9rem; }

  .hero { margin-bottom: var(--space-6); }
  .hero-sub { color: var(--muted); font-size: 13px; margin-top: 2px; }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: var(--space-5);
    align-items: start;
  }
  .main {
    display: grid;
    gap: var(--space-5);
    min-width: 0;
  }
  .rail {
    display: grid;
    gap: var(--space-5);
    min-width: 0;
  }
  .rail > :global(.card) {
    min-width: 0;
  }

  /* Queries the AppShell <main> content container (sidebar-aware, not the
     viewport) so the rail stacks based on actual available width. Threshold
     is 900px of *main's own rendered width* minus its 64px horizontal
     padding (32px each side) — @container always measures the container's
     content-box, so the written value must subtract that padding to land
     the stack point where "main width < 900px" actually reads as intended. */
  @container (max-width: 836px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
