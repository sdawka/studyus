<script lang="ts">
  // Stage 1 of the absorb flow: a layered list (not a graph viz — v1 keeps
  // this to a clean column layout per the wave brief) of the target KC's
  // prerequisites, grouped by depth (BFS distance from the target), deepest
  // first so the reading order runs foundation -> target. Readiness comes
  // straight from the server (`ready = status !== 'not-started' && mastery
  // >= REVIEW_THRESHOLD`, docs/api.md) — this component never recomputes it.
  import type { PrereqNode, TargetKc } from './types';

  interface Props {
    kc: TargetKc;
    prereqs: PrereqNode[];
    warnings: string[];
    onVerify: (kcIds: string[]) => void;
    onProceed: () => void;
  }
  const { kc, prereqs, warnings, onVerify, onProceed }: Props = $props();

  const notReady = $derived(prereqs.filter((p) => !p.ready));
  const allReady = $derived(notReady.length === 0);

  // Group by depth, largest depth (farthest prereq) first.
  const depthGroups = $derived.by(() => {
    const byDepth = new Map<number, PrereqNode[]>();
    for (const p of prereqs) {
      const group = byDepth.get(p.depth) ?? [];
      group.push(p);
      byDepth.set(p.depth, group);
    }
    return [...byDepth.entries()].sort((a, b) => b[0] - a[0]);
  });

  function statusLabel(status: string): string {
    return { 'not-started': 'Not started', learning: 'Learning', review: 'Review', mastered: 'Mastered' }[status] ?? status;
  }
</script>

<div class="prereq-map">
  {#if warnings.length > 0}
    <p class="warning">Heads up: {warnings.join(' ')}</p>
  {/if}

  {#if prereqs.length === 0}
    <p class="no-prereqs">No prerequisites to check — you're clear to dive straight in.</p>
  {:else}
    <div class="groups">
      {#each depthGroups as [depth, nodes] (depth)}
        <section class="depth-group">
          <p class="depth-label">{depth} hop{depth === 1 ? '' : 's'} away</p>
          <ul class="node-list">
            {#each nodes as p (p.kc_id)}
              <li class="node" class:ready={p.ready}>
                <span class="ready-mark" aria-hidden="true">{p.ready ? '✓' : '!'}</span>
                <span class="node-body">
                  <span class="node-title-row">
                    <span class="node-name">{p.name}</span>
                    <span class="kc-type">{p.kc_type}</span>
                  </span>
                  <span class="node-meta-row">
                    <span class="mastery-track"><span class="mastery-fill" style={`width:${p.mastery}%`}></span></span>
                    <span class="mastery-pct">{p.mastery}%</span>
                    <span class="status-word">{statusLabel(p.status)}</span>
                  </span>
                </span>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}

  <div class="target-card">
    <span class="target-kicker">You're about to learn</span>
    <span class="target-name">{kc.name}</span>
    <span class="kc-type">{kc.kc_type}</span>
  </div>

  <div class="actions">
    {#if notReady.length > 0}
      <button type="button" class="btn-primary" onclick={() => onVerify(notReady.map((p) => p.kc_id))}>
        Verify {notReady.length} weak prerequisite{notReady.length === 1 ? '' : 's'}
      </button>
      <button type="button" class="btn-secondary" onclick={onProceed}>Continue anyway</button>
    {:else}
      <button type="button" class="btn-primary" onclick={onProceed}>Continue</button>
    {/if}
  </div>
</div>

<style>
  .prereq-map { display: flex; flex-direction: column; gap: 1.25rem; max-width: 640px; }
  .warning { color: var(--warn-ink); background: var(--warn-soft); border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.85rem; margin: 0; }
  .no-prereqs { color: var(--muted); font-size: 0.9rem; }

  .groups { display: flex; flex-direction: column; gap: 1rem; }
  .depth-group { display: flex; flex-direction: column; gap: 0.5rem; }
  .depth-label { margin: 0; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--faint); }

  .node-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .node {
    display: flex;
    align-items: flex-start;
    gap: 0.7rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .node.ready { border-color: var(--good); }
  .ready-mark {
    flex: none;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 0.75rem;
    font-weight: 700;
    background: var(--warn-soft);
    color: var(--warn-ink);
    margin-top: 0.1rem;
  }
  .node.ready .ready-mark { background: var(--good-soft); color: var(--good-ink); }

  .node-body { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; flex: 1; }
  .node-title-row { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  /* Two-line clamp, not single-line ellipsis (repo convention, see
     TaskItem.svelte): 390px shots crushed prereq names to "Conservative
     vector fields an…". */
  .node-name { font-size: 0.92rem; font-weight: 550; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .kc-type {
    flex: none;
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.1rem 0.4rem;
  }
  .node-meta-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .mastery-track { width: 90px; height: 5px; border-radius: 4px; background: var(--hairline); overflow: hidden; }
  .mastery-fill { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
  .mastery-pct { font-size: 0.72rem; color: var(--muted); min-width: 2.2em; }
  .status-word { font-size: 0.72rem; color: var(--muted); }

  .target-card {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.9rem 1rem;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent-ink);
  }
  .target-kicker { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.85; }
  .target-name { font-size: 1.05rem; font-weight: 650; }
  .target-card .kc-type { align-self: flex-start; color: var(--accent-ink); border-color: currentColor; opacity: 0.8; }

  .actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  button { padding: 0.6rem 1rem; border-radius: 8px; border: none; cursor: pointer; font-size: 0.9rem; font-weight: 550; }
  .btn-primary { background: var(--accent); color: var(--surface); }
  .btn-secondary { background: var(--hover); color: var(--text); }

  /* main content-box ≤ 480px: mastery track loses its fixed width so the
     status word doesn't get squeezed off the row's end. */
  @container (max-width: 480px) {
    .mastery-track { width: auto; flex: 1; min-width: 40px; }
  }
</style>
