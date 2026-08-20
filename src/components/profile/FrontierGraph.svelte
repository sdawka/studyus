<script lang="ts">
  // One course's frontier chips. Shares PrereqGraph.svelte's node visual
  // language (ready-mark, mastery track, status word) rather than a new
  // vocabulary — but flat, not depth-grouped, since v1 renders no edges at
  // all (every node here is on the frontier, i.e. already "ready" by
  // definition; the noted follow-up is drawing the prereq edges themselves).
  import type { FrontierByCourse } from '../../lib/schemas/zpd';
  import { hueFor } from '../../lib/courseHue';

  interface Props {
    course: FrontierByCourse;
  }
  const { course }: Props = $props();

  const hue = $derived(hueFor({ slug: course.course_slug, color: course.color }));

  function statusLabel(status: string): string {
    return { 'not-started': 'Not started', learning: 'Learning', review: 'Review', mastered: 'Mastered' }[status] ?? status;
  }
</script>

<section class="frontier-course" style={`--course-h:${hue}`}>
  <h3 class="course-head">
    <span class="course-title">{course.course_title}</span>
    <span class="chip-count num">{course.frontier.length}</span>
  </h3>

  <ul class="node-list">
    {#each course.frontier as kc (kc.kc_id)}
      <li class="node ready">
        <a class="node-link" href={`/learn/${kc.kc_id}`}>
          <span class="ready-mark" aria-hidden="true">✓</span>
          <span class="node-body">
            <span class="node-name">{kc.name}</span>
            <span class="node-meta-row">
              <span class="mastery-track"><span class="mastery-fill" style={`width:${kc.mastery}%`}></span></span>
              <span class="mastery-pct num">{kc.mastery}%</span>
              <span class="status-word">{statusLabel(kc.status)}</span>
            </span>
          </span>
        </a>
      </li>
    {/each}
  </ul>
</section>

<style>
  .frontier-course {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding-left: 0.75rem;
    border-left: 3px solid var(--course);
    min-width: 0;
  }
  .course-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    min-width: 0;
  }
  .course-title { color: var(--course-ink); min-width: 0; overflow-wrap: anywhere; }
  .chip-count { font-size: 0.72rem; color: var(--muted); font-weight: 500; }

  .node-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
    gap: 0.5rem;
  }
  .node {
    min-width: 0;
    border: 1px solid var(--border, var(--hairline));
    border-radius: 10px;
    background: var(--surface);
  }
  .node.ready { border-color: var(--good); }
  .node-link {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.55rem 0.7rem;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }
  .ready-mark {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 0.68rem;
    font-weight: 700;
    background: var(--good-soft);
    color: var(--good-ink);
    margin-top: 0.1rem;
  }
  .node-body { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; flex: 1; }
  .node-name {
    font-size: 0.85rem;
    font-weight: 550;
    color: var(--text);
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .node-link:hover .node-name { color: var(--accent-ink, var(--accent)); }
  .node-meta-row { display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; min-width: 0; }
  .mastery-track { flex: 1 1 60px; min-width: 40px; height: 5px; border-radius: 4px; background: var(--hairline); overflow: hidden; }
  .mastery-fill { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
  .mastery-pct { font-size: 0.68rem; color: var(--muted); flex-shrink: 0; }
  .status-word { font-size: 0.68rem; color: var(--muted); flex-shrink: 0; }
</style>
