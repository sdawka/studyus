<script lang="ts">
  import OnboardingSetup from '../../../../src/components/onboarding/OnboardingSetup.svelte';
  import CourseDomainEditor from '../../../../src/components/course/CourseDomainEditor.svelte';
  import CourseModules from '../../../../src/components/course/CourseModules.svelte';
  import NextMoveCard from '../../../../src/components/dashboard/NextMoveCard.svelte';
  import { loadDefaultCourse } from '../../../../src/lib/content/defaultCourse';
  import type { NextMoveResponse } from '../../../../src/lib/schemas/nextMove';

  // This is deliberately a component harness, not an authenticated app E2E:
  // the bundled course is cloned by its production safe loader and every API
  // response is supplied by Playwright at the browser boundary.
  const draft = loadDefaultCourse();
  const view = new URLSearchParams(window.location.search).get('view') ?? 'onboarding';
  const nextMove: NextMoveResponse = {
    generated_at: '2026-09-23T12:00:00.000Z',
    available_minutes: 25,
    recommendation: {
      action_id: 'next-practice-evidence',
      kind: 'frontier_understand',
      method: 'understand',
      title: 'Check your evidence plan',
      course: { course_id: 'course-id', course_slug: 'learning-how-to-learn', course_code: 'LHTL 101', course_title: 'Learning How to Learn', color: '264' },
      kc: { kc_id: 'kc-evidence', name: 'Records beat feelings', mastery: 20, status: 'learning' },
      assessment: null,
      planned_minutes: 25,
      question_count: null,
      action_href: '/courses/learning-how-to-learn#experience-practice-evidence',
      activity: { experience_id: 'practice-evidence', kind: 'exercise' },
      reasons: [{ code: 'mastery_need', label: 'This is the first evidence plan to strengthen.' }],
    },
    alternatives: [],
  };
</script>

{#if view === 'onboarding'}
  <OnboardingSetup />
{:else if view === 'course'}
  <main class="app-view"><CourseModules courseId="course-id" {draft} recommendedExperienceId="practice-evidence" /></main>
{:else if view === 'editor'}
  <main class="app-view"><CourseDomainEditor courseId="course-id" initialDraft={loadDefaultCourse()} initialRevision={1} /></main>
{:else if view === 'next'}
  <main class="app-view"><NextMoveCard initialResponse={nextMove} /></main>
{:else}
  <p role="alert">Unknown first-user fixture view.</p>
{/if}

<style>
  .app-view { max-width: 920px; margin: 0 auto; padding: 28px; }
  @media (max-width: 767px) { .app-view { padding: 16px; } }
</style>
