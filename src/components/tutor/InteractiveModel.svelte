<script lang="ts">
  import { evaluateModelSpec, type ModelSpec } from '../../lib/services/tutor/modelSpec';

  let { spec }: { spec: ModelSpec } = $props();

  let values = $state<Record<string, number>>(Object.fromEntries(spec.parameters.map((p) => [p.id, p.default])));

  const outputs = $derived(evaluateModelSpec(spec, values));
</script>

<div class="model">
  {#if spec.title}<h3>{spec.title}</h3>{/if}

  <div class="sliders">
    {#each spec.parameters as p (p.id)}
      <label>
        <span>{p.label ?? p.id}{p.unit ? ` (${p.unit})` : ''}: {values[p.id]}</span>
        <input type="range" min={p.min} max={p.max} step={p.step ?? 1} bind:value={values[p.id]} />
      </label>
    {/each}
  </div>

  {#if outputs.length}
    <div class="outputs">
      {#each outputs as o (o.id)}
        <div class="output">
          <span class="label">{o.label ?? o.id}:</span>
          {#if o.error}
            <span class="err">couldn't evaluate ({o.error})</span>
          {:else}
            <span class="value">{o.value?.toFixed(3)}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if spec.notes}<p class="notes">{spec.notes}</p>{/if}
</div>

<style>
  .model {
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 10px;
    padding: 1rem;
    background: var(--panel, #fafafa);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .model h3 { margin: 0; }
  .sliders { display: flex; flex-direction: column; gap: 0.6rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
  input[type='range'] { width: 100%; }
  .outputs { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.9rem; }
  .output .label { font-weight: 500; margin-right: 0.4rem; }
  .err { color: #b91c1c; }
  .notes { color: #6b7280; font-size: 0.85rem; margin: 0; }
</style>
