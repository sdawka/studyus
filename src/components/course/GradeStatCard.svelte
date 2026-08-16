<script lang="ts">
  // Rail card: the course's weighted-grade standing, demoted from the old
  // overview hero to a compact reference stat (task-oriented overview leads
  // with what to DO; the grade is something you check, not something you
  // act on). The figure comes from /grades/summary via the parent island.
  interface Props {
    weightedGrade: number | null;
    gradedCount: number;
    officialCount: number;
  }
  let { weightedGrade, gradedCount, officialCount }: Props = $props();
</script>

<section class="card">
  <div class="card-head">
    <h2 class="card-title">Standing</h2>
  </div>

  <p class="figure num">{weightedGrade !== null ? `${weightedGrade}%` : '—'}</p>
  {#if weightedGrade === null}
    <p class="sub">No grades entered yet.</p>
  {:else}
    <p class="sub">Weighted grade · {gradedCount} of {officialCount} graded</p>
  {/if}

  <div class="card-footer">
    <a class="link-btn" href="#assessments">Enter grades →</a>
  </div>
</section>

<style>
  .figure {
    font-size: 26px;
    font-weight: 640;
    letter-spacing: -0.01em;
    line-height: 1.1;
    margin: 0;
  }
  .sub {
    color: var(--muted);
    font-size: 12.5px;
    margin: 4px 0 0;
  }

  .card-footer {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }
  .link-btn { color: var(--accent); font-size: 12.5px; font-weight: 550; text-decoration: none; }
  .link-btn:hover { text-decoration: underline; }
</style>
