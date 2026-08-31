<script lang="ts">
  // The add form in the card footer. The draft is bound rather than owned here
  // because it deliberately outlives the form: Cancel only hides the form, and
  // reopening shows what the user had already typed. The card therefore keeps
  // the draft, and this component is the view over it.
  import { ASSESSMENT_TYPES, type AddAssessmentDraft } from '../../lib/assessments';
  import type { CourseKcsSource } from '../../lib/courseKcs.svelte';
  import ConceptPicker from './ConceptPicker.svelte';

  interface Props {
    draft: AddAssessmentDraft;
    saving: boolean;
    error: string | null;
    kcSource: CourseKcsSource;
    onSubmit: () => void;
    onCancel: () => void;
  }
  let { draft = $bindable(), saving, error, kcSource, onSubmit, onCancel }: Props = $props();

  function toggleKc(id: string) {
    const next = new Set(draft.kcIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // A Set is not deeply reactive: reassign the field rather than mutating it.
    draft.kcIds = next;
  }

  function onsubmit(e: Event) {
    e.preventDefault();
    onSubmit();
  }
</script>

<form class="add-form" {onsubmit}>
  <div class="add-row">
    <input type="text" placeholder="Title" bind:value={draft.title} disabled={saving} />
    <select bind:value={draft.type} disabled={saving}>
      {#each ASSESSMENT_TYPES as t}
        <option value={t}>{t}</option>
      {/each}
    </select>
  </div>
  <div class="add-row">
    <div class="kind-toggle" role="group" aria-label="Counts toward grade">
      <button type="button" class:active={draft.kind === 'official'} onclick={() => (draft.kind = 'official')}>Official</button>
      <button type="button" class:active={draft.kind === 'practice'} onclick={() => (draft.kind = 'practice')}>Practice</button>
    </div>
    {#if draft.kind === 'official'}
      <input type="number" min="0" max="100" placeholder="Weight %" bind:value={draft.weight} disabled={saving} class="weight-input" />
    {/if}
    <input type="date" bind:value={draft.due} disabled={saving} />
  </div>
  <ConceptPicker source={kcSource} selected={draft.kcIds} onToggle={toggleKc} />
  <div class="add-row">
    <button type="submit" class="btn btn-primary" disabled={saving || !draft.title.trim()}>{saving ? 'Adding…' : 'Add'}</button>
    <button type="button" class="btn btn-secondary" disabled={saving} onclick={onCancel}>Cancel</button>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
</form>

<style>
  .add-form { display: flex; flex-direction: column; gap: var(--space-2); }
  .error { color: var(--danger); font-size: 12px; margin: 0; }

  .add-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .add-row input[type='text'] {
    flex: 1;
    min-width: 8rem;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 13px;
    background: var(--surface);
    color: var(--text);
  }
  .add-row select,
  .add-row input[type='date'] {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 12.5px;
    background: var(--surface);
    color: var(--text);
  }
  .weight-input { width: 5.5rem; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }

  .kind-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
  .kind-toggle button {
    padding: 5px 10px;
    font-size: 12px;
    font-weight: 550;
    color: var(--muted);
    border-right: 1px solid var(--border);
  }
  .kind-toggle button:last-child { border-right: none; }
  .kind-toggle button.active { background: var(--accent); color: var(--accent-contrast); }

  /* PHONE — main content-box ≤ 480px: the title input takes its own full
     line, letting type/date/weight wrap to the next. */
  @container (max-width: 480px) {
    .add-row input[type='text'] {
      flex: 1 1 100%;
      min-width: 0;
    }
  }
</style>
