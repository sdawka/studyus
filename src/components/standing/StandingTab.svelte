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
  import { apiFetch, NETWORK_ERROR_MESSAGE } from '../../lib/apiClient';
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
      const [courseResult, assessmentsResult, gradesResult, eventsResult, calendarResult] = await Promise.all([
        apiFetch<CourseDetail>(`/api/v1/courses/${courseSlug}`),
        apiFetch<Assessment[]>(`/api/v1/courses/${courseId}/assessments`),
        apiFetch<{ by_course: { course_id: string; weighted_grade: number | null }[] }>(`/api/v1/grades/summary`),
        apiFetch<EventRow[]>(`/api/v1/events?course=${courseId}&limit=50`),
        apiFetch<CalendarItem[]>(
          `/api/v1/calendar?course=${courseId}&from=${new Date().toISOString()}&to=${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()}`,
        ),
      ]);

      if (!courseResult.ok || !assessmentsResult.ok || !gradesResult.ok || !eventsResult.ok || !calendarResult.ok) {
        loadError = 'Could not load standing data.';
        return;
      }

      branches = courseResult.data.branches;
      meetingDays = courseResult.data.meeting_days ?? null;

      assessments = assessmentsResult.data;

      const mine = gradesResult.data.by_course.find((c) => c.course_id === courseId);
      weightedGrade = mine?.weighted_grade ?? null;

      events = eventsResult.data;

      deadlines = calendarResult.data;
    } catch {
      // Guards the extremely rare case of a 2xx response with an unparseable
      // body (apiFetch already returns `ok:true` there; accessing `.data`'s
      // shape below is what would throw) — same fallback as before.
      loadError = NETWORK_ERROR_MESSAGE;
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
    // Best-effort refresh; the saved grade already reflects on the assessment row.
    const result = await apiFetch<{ by_course: { course_id: string; weighted_grade: number | null }[] }>(`/api/v1/grades/summary`);
    if (!result.ok) return;
    const mine = result.data.by_course.find((c) => c.course_id === courseId);
    weightedGrade = mine?.weighted_grade ?? null;
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
    <!-- Reordered (T4 a11y pass) so keyboard/AT traversal leads with the
         "hallway jobs" — check off a task, mark attendance, glance
         deadlines/practice/activity — before Assessments/Mastery's deeper
         two-column read, instead of today's DOM order which put
         Assessments/Deadlines/Mastery first for every input method except
         the mobile *visual* layout (which reordered via CSS `order` alone,
         leaving keyboard/AT traversal unchanged and badly mismatched from
         what mobile users see). `.rail`/`.main` stay genuinely independent
         grids each (not flattened at desktop) specifically so one column's
         card heights can never inflate the other's row tracks — a single
         shared grid with per-card grid-row pairing was tried and rejected
         here because it can misplace cards whenever the two columns' card
         heights differ (real risk given these are variable-length lists),
         so full interleaving with Assessments/Deadlines/Mastery threaded
         between Attendance and Practice — the exact old mobile visual
         order — isn't reproduced; see the T4 report for the reasoning. -->
    <aside class="rail">
      <div class="slot slot-tasks"><TasksCard {courseId} {courseSlug} /></div>
      <div class="slot slot-attendance"><AttendanceCard {courseId} meetingDaysInitial={meetingDays} /></div>
      <div class="slot slot-practice"><PracticeCard {courseId} {courseSlug} refreshToken={practiceRefreshToken} /></div>
      <div class="slot slot-activity"><RecentActivityCard {events} /></div>
    </aside>
    <div class="main">
      <!-- DOM order Deadlines→Assessments→Mastery matches the mobile visual
           order below; the desktop-only `order:` on these three slot
           classes (in the stylesheet) restores today's Assessments-first
           desktop visual on top of it — safe because .main is its own
           single-column grid, so `order` here can never pair two different
           columns' cards into a shared row. -->
      <div class="slot slot-deadlines"><DeadlinesCard {deadlines} /></div>
      <div class="slot slot-assessments">
        <AssessmentsCard {courseId} {assessments} onGraded={refetchGrade} onPracticeChange={bumpPracticeRefresh} />
      </div>
      <div class="slot slot-mastery"><MasteryCard {branches} /></div>
    </div>
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
  /* .rail is now the first DOM child (T4 a11y reorder) but must stay
     pinned to the narrow visual column, so its grid-column is explicit
     rather than relying on auto-placement order. .main likewise. Each stays
     its own independent `display:grid` stack (unchanged from before the
     reorder) so one column's card heights can never affect the other's row
     tracks — see the markup comment above for why that independence
     matters here. */
  .main {
    grid-column: 1;
    /* grid-row is load-bearing alongside grid-column: .rail precedes .main
       in DOM, and the sparse auto-placement cursor never backtracks — with
       only the column pinned, .main lands in row 2 under a full-height gap. */
    grid-row: 1;
    display: grid;
    gap: var(--space-5);
    min-width: 0;
  }
  .rail {
    grid-column: 2;
    grid-row: 1;
    display: grid;
    gap: var(--space-5);
    min-width: 0;
  }
  /* Each card is wrapped in a .slot div — .slot carries the min-width:0 that
     a direct grid-item child needs to shrink below its content's intrinsic
     width instead of overflowing .main/.rail's tracks. */
  .slot {
    min-width: 0;
  }

  /* Desktop-only: restores today's Assessments-first visual order inside
     .main's independent single-column stack, on top of the Deadlines-first
     DOM order the markup now uses for keyboard/AT traversal. Safe to do
     with `order` here specifically because .main only ever has one card per
     row regardless of order — no other column's card can land in the same
     row track. */
  .slot-assessments { order: 1; }
  .slot-deadlines { order: 2; }
  .slot-mastery { order: 3; }

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
    /* Mobile order: hallway jobs first (check off a task, mark attendance,
       glance deadlines) before the deeper-engagement cards. Promoting
       .main/.rail to display:contents lets their .slot children become
       direct items of .grid, so `order` can interleave cards across the
       former column boundary — single column here, so (unlike the shared
       row-track problem at the two-column desktop width) there's no
       cross-column coupling risk in doing this. These values override the
       desktop-only .slot-assessments/-deadlines/-mastery order above. */
    .main,
    .rail {
      display: contents;
    }
    .slot-tasks { order: 1; }
    .slot-attendance { order: 2; }
    .slot-deadlines { order: 3; }
    .slot-assessments { order: 4; }
    .slot-mastery { order: 5; }
    .slot-practice { order: 6; }
    .slot-activity { order: 7; }
  }
</style>
