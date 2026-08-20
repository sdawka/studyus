<script lang="ts">
  // Learning frontier panel — replaces the old "Global knowledge map —
  // coming later" sketch. Frontier = unmastered KCs whose every prerequisite
  // is already ready (src/lib/zpd.ts); grouped by course, each chip links to
  // /learn/[kcId] for an absorb session. Informational only, per the repo's
  // anti-gamification stance — no score, no streak, just "here's what's in
  // reach right now."
  //
  // Props contract (frozen for profile.astro to wire from
  // getGlobalFrontier):
  //
  //   frontier: FrontierResponse | null  (src/lib/schemas/zpd.ts)
  //
  // Null until profile.astro wires the real service — renders a light
  // loading/placeholder state rather than nothing, so the panel doesn't
  // visibly flash in once data arrives.
  import type { FrontierResponse } from '../../lib/schemas/zpd';
  import FrontierGraph from './FrontierGraph.svelte';

  interface Props {
    frontier: FrontierResponse | null;
  }
  const { frontier }: Props = $props();
</script>

<section class="card">
  <h2>Learning frontier</h2>
  <p class="stepdesc">
    The concepts you're ready for next — unmastered, with every prerequisite already in reach.
  </p>

  {#if frontier === null}
    <p class="loading">Loading your frontier…</p>
  {:else if frontier.counts.total === 0}
    <p class="empty">Add a course to see your learning frontier here.</p>
  {:else if frontier.by_course.length === 0}
    <p class="empty">
      Nothing's fully ready yet — every unmastered concept still has a prerequisite to firm up first.
    </p>
  {:else}
    <!-- Blocked/mastered are informational counts, not per-course (the wire
         contract groups only frontier KCs by course) — one summary line
         rather than a score of any kind. -->
    <p class="summary">
      {frontier.counts.frontier} ready to learn
      {#if frontier.counts.blocked > 0}
        · {frontier.counts.blocked} waiting on a prerequisite
      {/if}
      · {frontier.counts.mastered} of {frontier.counts.total} mastered
    </p>

    <div class="course-groups">
      {#each frontier.by_course as course (course.course_id)}
        <FrontierGraph {course} />
      {/each}
    </div>
  {/if}
</section>

<style>
  section.card { margin-bottom: 1.75rem; }
  .card h2 { font-size: 1.05rem; margin: 0 0 0.6rem; }
  .stepdesc { color: var(--muted); font-size: 0.88rem; max-width: 620px; margin: 0 0 1rem; }
  .loading, .empty { color: var(--muted); font-size: 0.88rem; margin: 0; }
  .summary { color: var(--muted); font-size: 0.82rem; margin: 0 0 1rem; }

  .course-groups {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    min-width: 0;
  }
</style>
