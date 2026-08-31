<script lang="ts">
  // Course home island (task-oriented overview, replaces standing/StandingTab).
  // The page leads with WHAT TO DO for this course — open tasks, the
  // unmarked class session, weak/stale concepts worth absorbing, the nearest
  // weighted deadlines — and demotes reference material (grade standing,
  // the assessments ledger, mastery breakdown, the overview blurb) below it.
  //
  // Data strategy: everything the server already loaded arrives as props
  // (tasks SSR-seed the shared store via hydrateTasks; branches/KCs feed
  // UnderstandNext + MasteryCard with zero fetches), so the actionable fold
  // renders immediately. Only the reference cards that need API data
  // (assessments/grade/events) fetch here, behind their own skeletons.
  // AttendanceCard and PracticeCard keep their own fetches, unchanged.
  import { apiFetch } from '../../lib/apiClient';
  import { hydrateTasks, type ApiTask } from '../../lib/stores/tasks';
  import type { UnderstandNextKc } from '../../lib/understandNext';
  import type { Assessment } from '../../lib/assessments';
  import CourseTasks from './CourseTasks.svelte';
  import UnderstandNext from './UnderstandNext.svelte';
  import UpNextCard from './UpNextCard.svelte';
  import GradeStatCard from './GradeStatCard.svelte';
  import AttendanceCard from '../standing/AttendanceCard.svelte';
  import PracticeCard from '../standing/PracticeCard.svelte';
  import AssessmentsCard from '../standing/AssessmentsCard.svelte';
  import MasteryCard from '../standing/MasteryCard.svelte';
  import RecentActivityCard from '../standing/RecentActivityCard.svelte';

  interface Branch {
    id: string;
    name: string;
    kcs: UnderstandNextKc[];
  }
  interface EventRow {
    id: string;
    type: string;
    ts: string;
    source: 'manual' | 'session' | 'tutor' | 'seed';
    kc_id: string | null;
  }

  interface Props {
    courseId: string;
    courseSlug: string;
    courseCode: string;
    courseHue: number;
    meetingDays: number[] | null;
    overview: string | null;
    branches: Branch[];
    initialTasks: ApiTask[];
  }
  let { courseId, courseSlug, courseCode, courseHue, meetingDays, overview, branches, initialTasks }: Props = $props();

  // First-hydrator-wins: seeds the whole task list (not just this course's)
  // so TodoDropdown and any other task island on this page stay complete.
  hydrateTasks(initialTasks);

  const courseHues = { [courseId]: courseHue };
  let allKcs = $derived(branches.flatMap((b) => b.kcs));

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let assessments = $state<Assessment[]>([]);
  let weightedGrade = $state<number | null>(null);
  let events = $state<EventRow[]>([]);

  let gradedCount = $derived(assessments.filter((a) => a.kind === 'official' && a.grade_received !== null).length);
  let officialCount = $derived(assessments.filter((a) => a.kind === 'official').length);

  async function loadAll() {
    loading = true;
    loadError = null;
    const [assessmentsResult, gradesResult, eventsResult] = await Promise.all([
      apiFetch<Assessment[]>(`/api/v1/courses/${courseId}/assessments`),
      apiFetch<{ by_course: { course_id: string; weighted_grade: number | null }[] }>(`/api/v1/grades/summary`),
      apiFetch<EventRow[]>(`/api/v1/events?course=${courseId}&limit=50`),
    ]);
    if (!assessmentsResult.ok || !gradesResult.ok || !eventsResult.ok) {
      loadError = 'Could not load course data.';
      loading = false;
      return;
    }
    assessments = assessmentsResult.data;
    weightedGrade = gradesResult.data.by_course.find((c) => c.course_id === courseId)?.weighted_grade ?? null;
    events = eventsResult.data;
    loading = false;
  }

  loadAll();

  let practiceRefreshToken = $state(0);
  function bumpPracticeRefresh() {
    practiceRefreshToken += 1;
  }

  // After an inline grade save: refresh the weighted grade AND this island's
  // assessments copy, so Standing's "N of M graded" and Coming up stay in
  // step. AssessmentsCard renders from this prop rather than a copy forked at
  // mount, so the refreshed array supersedes whatever it was showing.
  async function refetchAfterGrade() {
    const [gradesResult, assessmentsResult] = await Promise.all([
      apiFetch<{ by_course: { course_id: string; weighted_grade: number | null }[] }>(`/api/v1/grades/summary`),
      apiFetch<Assessment[]>(`/api/v1/courses/${courseId}/assessments`),
    ]);
    if (gradesResult.ok) {
      weightedGrade = gradesResult.data.by_course.find((c) => c.course_id === courseId)?.weighted_grade ?? null;
    }
    if (assessmentsResult.ok) assessments = assessmentsResult.data;
  }
</script>

{#snippet pendingCard(title: string)}
  <section class="card">
    <div class="card-head"><h2 class="card-title">{title}</h2></div>
    {#if loadError}
      <p class="load-error">{loadError}</p>
    {:else}
      <div class="skeleton">
        <div class="skeleton-row"></div>
        <div class="skeleton-row short"></div>
      </div>
    {/if}
  </section>
{/snippet}

<!-- Two independent column stacks (StandingTab's proven geometry: a shared
     grid would couple row heights across columns). DOM leads with .main —
     the To do section is THE hallway job on this page, and its attend_class
     rows make attendance completable without reaching the rail card, so
     keyboard/AT traversal meets every action type before the reference
     cards. Both wrappers pin grid-column AND grid-row: .rail follows .main
     in DOM and the sparse auto-placement cursor never backtracks, so an
     unpinned .rail would land in row 2 under a full-height gap. -->
<div class="grid">
  <div class="main">
    <div class="slot slot-tasks">
      <CourseTasks {courseId} {courseSlug} {courseCode} {courseHues} />
    </div>
    <div class="slot slot-understand">
      <UnderstandNext kcs={allKcs} {courseSlug} />
    </div>
    <div class="slot slot-assessments" id="assessments">
      {#if loading || loadError}
        {@render pendingCard('Assessments')}
      {:else}
        <AssessmentsCard {courseId} {assessments} onGraded={refetchAfterGrade} onPracticeChange={bumpPracticeRefresh} />
      {/if}
    </div>
    <div class="slot slot-mastery">
      <MasteryCard {branches} />
    </div>
    {#if overview}
      <div class="slot slot-about">
        <p class="kicker">About this course</p>
        <p class="about-text">{overview}</p>
      </div>
    {/if}
  </div>

  <aside class="rail">
    <div class="slot slot-attendance">
      <AttendanceCard {courseId} meetingDaysInitial={meetingDays} />
    </div>
    <div class="slot slot-upnext">
      {#if loading || loadError}
        {@render pendingCard('Coming up')}
      {:else}
        <UpNextCard {assessments} />
      {/if}
    </div>
    <div class="slot slot-standing">
      {#if loading || loadError}
        {@render pendingCard('Standing')}
      {:else}
        <GradeStatCard {weightedGrade} {gradedCount} {officialCount} />
      {/if}
    </div>
    <div class="slot slot-practice">
      <PracticeCard {courseId} {courseSlug} refreshToken={practiceRefreshToken} />
    </div>
    <div class="slot slot-activity">
      {#if loading || loadError}
        {@render pendingCard('Recent activity')}
      {:else}
        <RecentActivityCard {events} />
      {/if}
    </div>
  </aside>
</div>

<style>
  .load-error { color: var(--danger); font-size: 13px; }

  .skeleton { display: flex; flex-direction: column; gap: var(--space-2); }
  .skeleton-row { height: 16px; border-radius: var(--radius-sm); background: var(--hairline); opacity: 0.6; }
  .skeleton-row.short { width: 60%; }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: var(--space-5);
    align-items: start;
  }
  /* grid-row is load-bearing alongside grid-column on both wrappers — see
     the markup comment (sparse auto-placement never backtracks). Each stays
     its own independent grid stack so one column's card heights can never
     inflate the other's row tracks. */
  .main {
    grid-column: 1;
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
  /* .slot carries the min-width:0 a direct grid item needs to shrink below
     its content's intrinsic width instead of overflowing the track. */
  .slot {
    min-width: 0;
  }

  .about-text {
    margin: var(--space-2) 0 0;
    color: var(--text);
    font-size: 13.5px;
    max-width: 700px;
  }

  /* Queries the AppShell <main> content container (sidebar-aware, not the
     viewport). Threshold is 900px of main's rendered width minus its 64px
     horizontal padding — @container measures the content-box, so the
     written value subtracts that padding (same arithmetic StandingTab
     carried). Single column: promoting .main/.rail to display:contents
     lets `order` interleave their slots across the former column boundary —
     no cross-column row coupling risk at one column. Order: hallway jobs
     (tasks, attendance), then the forward-looking cards (understand next,
     coming up), then reference. */
  @container (max-width: 836px) {
    .grid {
      grid-template-columns: 1fr;
    }
    .main,
    .rail {
      display: contents;
    }
    .slot-tasks { order: 1; }
    .slot-attendance { order: 2; }
    .slot-understand { order: 3; }
    .slot-upnext { order: 4; }
    .slot-standing { order: 5; }
    .slot-assessments { order: 6; }
    .slot-mastery { order: 7; }
    .slot-practice { order: 8; }
    .slot-activity { order: 9; }
    .slot-about { order: 10; }
  }
</style>
