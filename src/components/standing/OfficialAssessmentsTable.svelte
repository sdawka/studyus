<script lang="ts">
  // The graded table: official rows, with weights and inline grade entry. Owns
  // one thing besides markup — the grade a user is part-way through typing,
  // which is genuinely local (it belongs to the input, not to the server copy).
  //
  // Drafts are seeded once per row from that row's saved grade and memoized by
  // assessment id in a plain, non-reactive Map, so a row that only shows up
  // later — added in this card, or arriving in a refreshed prop — still has a
  // draft the first time it renders.
  import { formatDueDate } from '../../lib/plannerDates';
  import type { NumericFieldBinding } from '../../lib/numericField';
  import type { Assessment, EditSession, GradeEntry } from '../../lib/assessments';
  import type { CourseKcsSource } from '../../lib/courseKcs.svelte';
  import AssessmentEditForm from './AssessmentEditForm.svelte';

  interface Props {
    rows: Assessment[];
    savingIds: ReadonlySet<string>;
    feedback: Record<string, string>;
    edit: EditSession;
    kcSource: CourseKcsSource;
    onSaveGrade: (a: Assessment, entry: GradeEntry) => void;
  }
  let { rows, savingIds, feedback, edit, kcSource, onSaveGrade }: Props = $props();

  class GradeDraft implements GradeEntry {
    received = $state<NumericFieldBinding>('');
    max = $state<NumericFieldBinding>('');
    constructor(a: Assessment) {
      this.received = a.grade_received?.toString() ?? '';
      this.max = a.grade_max?.toString() ?? '';
    }
  }

  const drafts = new Map<string, GradeDraft>();
  function draftFor(a: Assessment): GradeDraft {
    let draft = drafts.get(a.id);
    if (!draft) {
      draft = new GradeDraft(a);
      drafts.set(a.id, draft);
    }
    return draft;
  }
</script>

<div class="table-wrap">
  <table>
    <thead>
      <tr><th>Title</th><th>Type</th><th>Due</th><th>Weight</th><th>Grade</th><th>Out of</th><th></th></tr>
    </thead>
    <tbody>
      {#each rows as a (a.id)}
        {@const draft = draftFor(a)}
        <tr>
          <td>{a.title}</td>
          <td class="capitalize">{a.type}</td>
          <td>{formatDueDate(a.due_date)}</td>
          <td class="num">{a.weight_pct !== null ? `${a.weight_pct}%` : '—'}</td>
          <td><input type="number" min="0" bind:value={draft.received} class="grade-input num" /></td>
          <td><input type="number" min="0" bind:value={draft.max} class="grade-input num" /></td>
          <td class="row-actions">
            <button type="button" class="btn btn-secondary" onclick={() => onSaveGrade(a, draft)} disabled={savingIds.has(a.id)}>
              {savingIds.has(a.id) ? 'Saving…' : 'Save'}
            </button>
            <button type="button" class="link-btn" onclick={() => edit.toggle(a)}>
              {edit.openId === a.id ? 'Close' : 'Edit'}
            </button>
          </td>
        </tr>
        {#if feedback[a.id]}
          <tr class="feedback-row"><td colspan="7">{feedback[a.id]}</td></tr>
        {/if}
        {#if edit.openId === a.id}
          <tr class="edit-row">
            <td colspan="7">
              <AssessmentEditForm assessment={a} {edit} {kcSource} />
            </td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
</div>

<style>
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th { text-align: left; padding: 6px 8px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--hairline); }
  td { padding: 8px; border-bottom: 1px solid var(--hairline); }
  .capitalize { text-transform: capitalize; }
  .grade-input { width: 4.5rem; padding: 5px 7px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
  .row-actions { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
  .feedback-row td { color: var(--good); font-size: 12px; padding-top: 0; }
  .edit-row td { padding-top: var(--space-4); padding-bottom: var(--space-4); background: var(--hairline); }

  .link-btn { background: none; color: var(--accent); font-size: 12.5px; font-weight: 550; padding: 2px 0; }
  .link-btn:hover { text-decoration: underline; }

  /* PHONE — main content-box ≤ 480px: remap each official-assessment row
     from a table row into a 2-row card grid so it reads without horizontal
     scrolling. Title gets its own full-width row; the other six <td>s
     (type, due, weight, grade-received, grade-max, actions) auto-place
     left-to-right into a 6-column second row — no named grid areas needed
     since that's exactly their DOM order already. Feedback/edit rows are a
     single colspan="7" <td>, so they just span the full row grid.
     .table-wrap's overflow-x:auto (above) stays as a mid-width fallback. */
  @container (max-width: 480px) {
    thead { display: none; }

    tbody tr {
      display: grid;
      grid-template-columns: auto auto auto 3.5rem 3.5rem 1fr;
      column-gap: 6px;
      row-gap: 6px;
      align-items: center;
      padding: 10px 2px;
    }
    tbody tr td {
      padding: 2px 0;
      border-bottom: none;
    }

    tbody tr:not(.feedback-row):not(.edit-row) td:first-child {
      grid-column: 1 / -1;
      font-weight: 550;
    }
    tbody tr:not(.feedback-row):not(.edit-row) td:nth-child(2),
    tbody tr:not(.feedback-row):not(.edit-row) td:nth-child(3),
    tbody tr:not(.feedback-row):not(.edit-row) td:nth-child(4) {
      font-size: 11.5px;
      color: var(--muted);
    }
    tbody tr.feedback-row td,
    tbody tr.edit-row td {
      grid-column: 1 / -1;
    }

    .grade-input { width: 3.5rem; height: 44px; box-sizing: border-box; padding: 0 7px; }
    .row-actions { justify-self: end; }
  }
</style>
