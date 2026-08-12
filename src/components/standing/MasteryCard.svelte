<script lang="ts">
  interface Kc { id: string; name: string; mastery: number; status: string }
  interface Branch { id: string; name: string; kcs: Kc[] }

  interface Props {
    branches: Branch[];
  }
  let { branches }: Props = $props();

  function branchMastery(branch: Branch): number {
    if (branch.kcs.length === 0) return 0;
    return Math.round(branch.kcs.reduce((sum, k) => sum + k.mastery, 0) / branch.kcs.length);
  }
</script>

<section class="card">
  <div class="card-head">
    <h2 class="card-title">Mastery by branch</h2>
  </div>
  {#if branches.length === 0}
    <p class="empty">No branches yet.</p>
  {:else}
    <ul class="branch-list">
      {#each branches as b}
        <li>
          <span class="branch-name">{b.name}</span>
          <div class="bar"><span style="width: {branchMastery(b)}%"></span></div>
          <span class="branch-pct num">{branchMastery(b)}%</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .branch-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .branch-list li { display: flex; align-items: center; gap: var(--space-3); font-size: 13.5px; }
  .branch-name { min-width: 9.5rem; flex-shrink: 0; }
  .branch-list li .bar { flex: 1; }
  .branch-pct { min-width: 2.5rem; text-align: right; color: var(--muted); }
</style>
