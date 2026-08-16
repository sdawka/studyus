<script lang="ts">
  // Stage 3: "what interests you most about this?" — tap prereqs in the
  // order you want to focus on them. Each tap appends to the ranked list
  // (tapping a ranked item again returns it to the unranked pool, so it's
  // undo-able); anything left unranked keeps its default (depth) order and
  // is appended after whatever was explicitly ranked. No drag dependency —
  // click-to-reorder per the wave brief.
  import type { PrereqNode } from './types';

  interface Props {
    prereqs: PrereqNode[];
    targetKcId: string;
    onContinue: (focusOrder: string[]) => void;
    onBack: () => void;
  }
  const { prereqs, targetKcId, onContinue, onBack }: Props = $props();

  let ranked = $state<string[]>([]);

  const unranked = $derived(prereqs.filter((p) => !ranked.includes(p.kc_id)));
  const byId = new Map(prereqs.map((p) => [p.kc_id, p]));

  function tap(kcId: string) {
    if (ranked.includes(kcId)) {
      ranked = ranked.filter((id) => id !== kcId);
    } else {
      ranked = [...ranked, kcId];
    }
  }

  function continueWithOrder() {
    const focusOrder = [...ranked, ...unranked.map((p) => p.kc_id), targetKcId];
    onContinue(focusOrder);
  }

  function skip() {
    onContinue([...prereqs.map((p) => p.kc_id), targetKcId]);
  }
</script>

<div class="ranker">
  <p class="prompt">Tap the ones you're most curious about first — the tutor will lean into that order.</p>

  {#if ranked.length > 0}
    <ol class="ranked-list">
      {#each ranked as kcId, i (kcId)}
        {@const node = byId.get(kcId)}
        {#if node}
          <li>
            <button type="button" class="rank-item ranked" onclick={() => tap(kcId)}>
              <span class="rank-num">{i + 1}</span>
              <span class="rank-name">{node.name}</span>
              <span class="undo-hint">tap to unrank</span>
            </button>
          </li>
        {/if}
      {/each}
    </ol>
  {/if}

  {#if unranked.length > 0}
    <div class="unranked-pool">
      {#each unranked as node (node.kc_id)}
        <button type="button" class="rank-item" onclick={() => tap(node.kc_id)}>
          <span class="rank-name">{node.name}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="actions">
    <button type="button" class="btn-secondary" onclick={onBack}>Back</button>
    <button type="button" class="btn-tertiary" onclick={skip}>Skip — use default order</button>
    <button type="button" class="btn-primary" onclick={continueWithOrder}>Start the session</button>
  </div>
</div>

<style>
  .ranker { display: flex; flex-direction: column; gap: 1rem; max-width: 560px; }
  .prompt { color: var(--muted); font-size: 0.9rem; margin: 0; }

  .ranked-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .unranked-pool { display: flex; flex-direction: column; gap: 0.4rem; }

  .rank-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    font-size: 0.9rem;
  }
  .rank-item.ranked { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); }
  .rank-num {
    flex: none;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: var(--accent);
    color: var(--surface);
    font-size: 0.72rem;
    font-weight: 700;
  }
  .rank-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .undo-hint { flex: none; font-size: 0.7rem; color: var(--muted); opacity: 0; transition: opacity var(--motion-fast, 130ms) ease; }
  .rank-item.ranked:hover .undo-hint { opacity: 1; }

  .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  button { border: none; cursor: pointer; font-size: 0.9rem; font-weight: 550; }
  .actions button { padding: 0.6rem 1rem; border-radius: 8px; }
  .btn-primary { background: var(--accent); color: var(--surface); }
  .btn-secondary { background: var(--hover); color: var(--text); }
  .btn-tertiary { background: none; color: var(--muted); }
</style>
