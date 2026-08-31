<script lang="ts">
  // The edit form for one assessment, rendered inline under its row in either
  // the official table or the practice list. The card owns the *session* (which
  // row is open, whether its save is in flight, what the server said); this
  // component owns only the fields being typed into.
  //
  // Those fields are seeded once, at mount, and the form is mounted per open —
  // which is what makes reopening a row show the current server values rather
  // than a stale draft. `untrack` says that "once" is deliberate: unlike the
  // list itself, this is not meant to track the row it came from.
  import { untrack } from 'svelte';
  import { ASSESSMENT_TYPES, type Assessment, type AssessmentFormDraft, type EditSession } from '../../lib/assessments';
  import type { CourseKcsSource } from '../../lib/courseKcs.svelte';
  import ConceptPicker from './ConceptPicker.svelte';

  interface Props {
    assessment: Assessment;
    edit: EditSession;
    kcSource: CourseKcsSource;
  }
  let { assessment, edit, kcSource }: Props = $props();

  const isOfficial = $derived(assessment.kind !== 'practice');

  let draft = $state<AssessmentFormDraft>(
    untrack(() => ({
      title: assessment.title,
      type: assessment.type,
      due: assessment.due_date ? assessment.due_date.slice(0, 10) : '',
      weight: assessment.weight_pct !== null ? String(assessment.weight_pct) : '',
      kcIds: new Set(assessment.kc_ids),
    })),
  );

  function toggleKc(id: string) {
    const next = new Set(draft.kcIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // A Set is not deeply reactive: reassign the field rather than mutating it.
    draft.kcIds = next;
  }

  function onsubmit(e: Event) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    edit.submit(assessment, draft);
  }
</script>

<form class="edit-form" {onsubmit}>
  <div class="add-row">
    <input type="text" placeholder="Title" bind:value={draft.title} disabled={edit.busy} />
    <select bind:value={draft.type} disabled={edit.busy}>
      {#each ASSESSMENT_TYPES as t}
        <option value={t}>{t}</option>
      {/each}
    </select>
    {#if !isOfficial}
      <input type="date" bind:value={draft.due} disabled={edit.busy} />
    {/if}
  </div>
  {#if isOfficial}
    <div class="add-row">
      <input type="number" min="0" max="100" placeholder="Weight %" bind:value={draft.weight} disabled={edit.busy} class="weight-input" />
      <input type="date" bind:value={draft.due} disabled={edit.busy} />
    </div>
  {/if}
  <ConceptPicker source={kcSource} selected={draft.kcIds} onToggle={toggleKc} />
  <div class="add-row">
    <button type="submit" class="btn btn-primary" disabled={edit.busy || !draft.title.trim()}>{edit.busy ? 'Saving…' : 'Save'}</button>
    <button type="button" class="btn btn-secondary" disabled={edit.busy} onclick={edit.cancel}>Cancel</button>
  </div>
  {#if edit.error}<p class="error">{edit.error}</p>{/if}
</form>

<style>
  .edit-form { display: flex; flex-direction: column; gap: var(--space-2); }
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

  /* PHONE — main content-box ≤ 480px: the title input takes its own full
     line, letting type/date/weight wrap to the next. */
  @container (max-width: 480px) {
    .add-row input[type='text'] {
      flex: 1 1 100%;
      min-width: 0;
    }
  }
</style>
