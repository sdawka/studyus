<script lang="ts">
  // The "Concepts covered" chip picker, shared by the add form and the edit
  // form. Purely a view over a CourseKcsSource: it renders whichever of the
  // four states that source is in (loading, failed, loaded-but-empty, loaded)
  // and hands a failure straight back to the user as a Retry.
  import type { CourseKcsSource } from '../../lib/courseKcs.svelte';

  interface Props {
    source: CourseKcsSource;
    selected: ReadonlySet<string>;
    onToggle: (id: string) => void;
  }
  let { source, selected, onToggle }: Props = $props();
</script>

<div class="kc-section">
  <p class="kicker">Concepts covered</p>
  {#if source.loading}
    <p class="kc-status">Loading concepts…</p>
  {:else if source.error}
    <div class="kc-status-row">
      <p class="kc-status error">{source.error}</p>
      <button type="button" class="link-btn" onclick={() => source.retry()}>Retry</button>
    </div>
  {:else if source.kcs && source.kcs.length === 0}
    <p class="kc-status">No concepts defined for this course yet.</p>
  {:else if source.kcs}
    <div class="kc-picker">
      {#each source.kcs as kc (kc.id)}
        <button type="button" class="chip" aria-pressed={selected.has(kc.id)} onclick={() => onToggle(kc.id)}>{kc.name}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .kc-section { display: flex; flex-direction: column; gap: 6px; }
  .kc-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 140px;
    overflow-y: auto;
    padding: 2px;
  }
  .kc-status { font-size: 12px; color: var(--muted); margin: 0; }
  .kc-status.error { color: var(--danger); }
  .kc-status-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  .link-btn { background: none; color: var(--accent); font-size: 12.5px; font-weight: 550; padding: 2px 0; }
  .link-btn:hover { text-decoration: underline; }
</style>
