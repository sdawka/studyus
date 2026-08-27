<script lang="ts">
  import StudyFlow from '../study/StudyFlow.svelte';
  import QuickQuiz from '../tutor/QuickQuiz.svelte';
  import type { RitualStepKind } from '../../lib/schemas/rituals';

  type Kc = { id: string; name: string; kcType: string; mastery: number | null; status: string | null };
  type StudyCourse = { id: string; slug: string; code: string; title: string; mastery: number | null; status: string | null };
  type OpenSession = {
    id: string;
    courseId: string | null;
    courseCode: string | null;
    intendedEventType: string;
    plannedMinutes: number | null;
    startedAt: number;
    ritualId?: string | null;
  } | null;
  type RitualOption = { id: string; name: string; steps: { kind: RitualStepKind; label?: string; minutes?: number }[] };

  interface Props {
    course: StudyCourse;
    courseSlug: string;
    drillKcs: Kc[];
    openSession: OpenSession;
    rituals?: RitualOption[];
    aiGenerationEnabled: boolean;
    aiUnavailableReason: 'disabled' | 'provider_not_configured' | null;
  }
  const {
    course,
    courseSlug,
    drillKcs,
    openSession,
    rituals = [],
    aiGenerationEnabled,
    aiUnavailableReason,
  }: Props = $props();
</script>

<div class="practice-panel">
  <section class="section">
    <h2>Study session</h2>
    <StudyFlow courses={[course]} openSession={openSession} preselectedCourseId={course.id} rituals={rituals} />
  </section>

  <section class="section" id="quick-quiz">
    <h2>Quick quiz</h2>
    <QuickQuiz
      courses={[{ id: course.id, title: course.title }]}
      preselectedCourse={course.id}
      {aiGenerationEnabled}
      {aiUnavailableReason}
    />
  </section>

  <section class="section">
    <h2>Drill a concept</h2>
    {#if drillKcs.length === 0}
      <p class="placeholder">No fact, association, concept, or rule KCs to drill yet.</p>
    {:else}
      <ul class="kc-list">
        {#each drillKcs as kc (kc.id)}
          <li>
            <a class="kc-row" href={`/courses/${courseSlug}/kc/${kc.id}`}>
              <span class="kc-name">{kc.name}</span>
              <span class="kc-type">{kc.kcType}</span>
              <div class="mastery-bar">
                <div class="track"><div class="fill" style={`width:${kc.mastery ?? 0}%`}></div></div>
                <span class="pct">{kc.mastery ?? 0}%</span>
              </div>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .practice-panel { display: flex; flex-direction: column; gap: 2rem; }
  .section h2 { font-size: 1rem; margin: 0 0 0.8rem 0; }
  .placeholder { color: var(--muted); font-size: 0.9rem; }
  .kc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .kc-row {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    text-decoration: none;
    color: var(--text);
  }
  .kc-row:hover { border-color: var(--accent); }
  .kc-name { flex: 1; font-size: 0.92rem; }
  .kc-type { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.1rem 0.4rem; }
  .mastery-bar { display: flex; align-items: center; gap: 0.5rem; width: 140px; }
  .track { flex: 1; height: 6px; border-radius: 999px; background: var(--border); overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; background: var(--accent); }
  .pct { font-size: 0.75rem; color: var(--muted); min-width: 2.5em; text-align: right; }

  /* PHONE — main content-box ≤ 480px: same two-line treatment as
     concepts.astro's kc-row — name/type on line 1, bar full-width on
     line 2 — since there's no separate status chip here. */
  @container (max-width: 480px) {
    .kc-row {
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas: "name type" "bar bar";
      column-gap: 0.6rem;
      row-gap: 0.4rem;
      align-items: center;
    }
    .kc-name {
      grid-area: name;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kc-type { grid-area: type; }
    .mastery-bar { grid-area: bar; width: auto; }
  }
</style>
