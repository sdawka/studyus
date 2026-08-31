<script lang="ts">
  // The quieter group below the graded table. Practice rows carry no weight and
  // no grade entry — a plain completion mark is enough, since they count toward
  // nothing. Same edit form as the official rows, just placed in the list item.
  import type { Assessment, EditSession } from '../../lib/assessments';
  import type { CourseKcsSource } from '../../lib/courseKcs.svelte';
  import AssessmentEditForm from './AssessmentEditForm.svelte';

  interface Props {
    rows: Assessment[];
    savingIds: ReadonlySet<string>;
    edit: EditSession;
    kcSource: CourseKcsSource;
    onSetDone: (a: Assessment, done: boolean) => void;
  }
  let { rows, savingIds, edit, kcSource, onSetDone }: Props = $props();
</script>

<div class="practice-group">
  <p class="group-label kicker">Practice — doesn't count toward your grade</p>
  <ul class="practice-list">
    {#each rows as p (p.id)}
      <li>
        <div class="practice-row">
          <span class="practice-title">{p.title}</span>
          {#if p.grade_received !== null}
            <span class="practice-score num">{p.grade_received}/{p.grade_max ?? 100}</span>
            <button type="button" class="link-btn" disabled={savingIds.has(p.id)} onclick={() => onSetDone(p, false)}>Undo</button>
          {:else}
            <button type="button" class="link-btn" disabled={savingIds.has(p.id)} onclick={() => onSetDone(p, true)}>Mark done</button>
          {/if}
          <button type="button" class="link-btn" onclick={() => edit.toggle(p)}>
            {edit.openId === p.id ? 'Close' : 'Edit'}
          </button>
        </div>
        {#if edit.openId === p.id}
          <AssessmentEditForm assessment={p} {edit} {kcSource} />
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .practice-group {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }
  .group-label { margin: 0 0 var(--space-2); }
  .practice-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .practice-list li { padding: 4px 0; }
  /* The form is AssessmentEditForm's root element, so this reaches across the
     component boundary on purpose. */
  .practice-list li > :global(.edit-form) { margin: 6px 0 4px; }
  .practice-row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--muted);
  }
  .practice-title { flex: 1; min-width: 0; color: var(--text); }
  .practice-score { color: var(--muted); }

  .link-btn { background: none; color: var(--accent); font-size: 12.5px; font-weight: 550; padding: 2px 0; }
  .link-btn:hover { text-decoration: underline; }
  .link-btn:disabled { opacity: 0.5; pointer-events: none; }
</style>
