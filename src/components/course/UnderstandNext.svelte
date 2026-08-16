<script lang="ts">
  // Course home's deep-work pointer: the few KCs most worth an absorb
  // session right now (selection logic + rationale in lib/understandNext).
  // Server data via props — no fetch; the Understand links are the same
  // /learn/[kcId] doors the Concepts tab rows carry. Renders nothing when
  // there's nothing to point at (no KCs, or everything mastered).
  import { selectUnderstandNext, type UnderstandNextKc } from '../../lib/understandNext';

  interface Props {
    kcs: UnderstandNextKc[];
    courseSlug: string;
  }
  let { kcs, courseSlug }: Props = $props();

  let picks = $derived(selectUnderstandNext(kcs));
</script>

{#if picks.length > 0}
  <section class="card">
    <div class="card-head">
      <h2 class="card-title">Understand next</h2>
      <a class="footer-link head-link" href={`/courses/${courseSlug}/concepts`}>All concepts →</a>
    </div>

    <ul class="pick-list">
      {#each picks as pick (pick.kc.id)}
        <li class="pick">
          <!-- Name line carries only the name + the Understand action; the
               bar/percent/pills live on their own meta line below so they
               can never crush the name (meta never on title lines). -->
          <div class="pick-top">
            <a class="pick-name" href={`/courses/${courseSlug}/kc/${pick.kc.id}`}>{pick.kc.name}</a>
            <a class="understand-link" href={`/learn/${pick.kc.id}`}>Understand →</a>
          </div>
          <div class="pick-meta">
            <div class="bar" class:low={pick.kc.mastery < 40}><span style="width: {pick.kc.mastery}%"></span></div>
            <span class="pct num">{pick.kc.mastery}%</span>
            {#if pick.reason === 'new'}
              <span class="pill pill-idle">not started</span>
            {:else if pick.idleDays !== null}
              <span class="pill pill-warn">idle {pick.idleDays}d</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .head-link {
    display: inline;
    border-top: none;
    padding: 0;
    text-align: right;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .pick-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .pick {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .pick:first-child { padding-top: 0; }
  .pick:last-child { border-bottom: none; padding-bottom: 0; }

  .pick-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
  }
  .pick-name {
    font-size: 13.5px;
    font-weight: 550;
    color: var(--text);
    text-decoration: none;
    min-width: 0;
    /* Two-line clamp, not single-line ellipsis (repo convention, see
       TaskItem): nowrap would crush long KC names at narrow widths. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .pick-name:hover { color: var(--accent-ink, var(--accent)); }

  .understand-link {
    flex-shrink: 0;
    font-size: 12.5px;
    font-weight: 550;
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
  }
  .understand-link:hover { text-decoration: underline; }

  .pick-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .pick-meta .bar {
    flex: 0 1 180px;
    min-width: 60px;
  }
  .pct {
    color: var(--muted);
    font-size: 12px;
    min-width: 2.4rem;
  }
  .pick-meta .pill { flex-shrink: 0; }
</style>
