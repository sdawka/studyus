<script lang="ts">
  import { apiFetch } from '../../lib/apiClient';
  import { numericFieldValue, type NumericFieldBinding } from '../../lib/numericField';

  interface Assessment {
    id: string;
    title: string;
    type: string;
    dueDate: number | null;
    weightPct: number | null;
    gradeReceived: number | null;
    gradeMax: number | null;
  }

  let {
    courseId,
    courseCode,
    courseTitle,
    weightedGrade,
    initialAssessments,
  }: {
    courseId: string;
    courseCode: string;
    courseTitle: string;
    weightedGrade: number | null;
    initialAssessments: Assessment[];
  } = $props();

  let assessments = $state<Assessment[]>(initialAssessments);
  let drafts = $state<Record<string, { received: NumericFieldBinding; max: NumericFieldBinding }>>(
    Object.fromEntries(
      initialAssessments.map((a) => [a.id, { received: a.gradeReceived?.toString() ?? '', max: a.gradeMax?.toString() ?? '' }]),
    ),
  );
  let savingId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let feedback = $state<Record<string, string>>({});

  function formatDue(ms: number | null): string {
    if (ms === null) return 'No due date';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function beginEditing(assessmentId: string) {
    editingId = assessmentId;
    feedback = { ...feedback, [assessmentId]: '' };
  }

  function cancelEditing(assessment: Assessment) {
    drafts = {
      ...drafts,
      [assessment.id]: {
        received: assessment.gradeReceived?.toString() ?? '',
        max: assessment.gradeMax?.toString() ?? '',
      },
    };
    editingId = null;
  }

  async function saveGrade(assessmentId: string) {
    const draft = drafts[assessmentId];
    if (!draft) return;
    savingId = assessmentId;
    feedback = { ...feedback, [assessmentId]: '' };
    try {
      const body: Record<string, number | null> = {};
      body.grade_received = numericFieldValue(draft.received);
      body.grade_max = numericFieldValue(draft.max);
      const result = await apiFetch(
        `/api/v1/assessments/${assessmentId}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        'Save failed',
      );
      if (!result.ok) {
        feedback = { ...feedback, [assessmentId]: result.error };
        return;
      }
      const updated = result.data as { grade_received: number | null; grade_max: number | null; mastery_deltas?: unknown[] };
      assessments = assessments.map((a) =>
        a.id === assessmentId ? { ...a, gradeReceived: updated.grade_received, gradeMax: updated.grade_max } : a,
      );
      editingId = null;
      const loggedEvent = Array.isArray(updated.mastery_deltas) && updated.mastery_deltas.length > 0;
      feedback = { ...feedback, [assessmentId]: loggedEvent ? 'Saved — logged a grade event for linked concepts.' : 'Saved.' };
    } finally {
      savingId = null;
    }
  }
</script>

<div class="course-panel">
  <div class="course-header">
    <h2>{courseCode} — {courseTitle}</h2>
    <span class="standing">{weightedGrade !== null ? `${weightedGrade}%` : 'no grades yet'}</span>
  </div>
  <p class="reminder">Entering a grade automatically logs an assessment event for any concepts linked to it.</p>

  {#if assessments.length === 0}
    <p class="muted">No assessments yet for this course.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Due</th>
            <th>Weight</th>
            <th>Grade</th>
            <th>Out of</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each assessments as a}
            <tr>
              <td>{a.title}</td>
              <td class="capitalize">{a.type}</td>
              <td>{formatDue(a.dueDate)}</td>
              <td>{a.weightPct !== null ? `${a.weightPct}%` : '—'}</td>
              <td>
                {#if editingId === a.id}
                  <label class="sr-only" for={`grade-received-${a.id}`}>Grade received for {a.title}</label>
                  <input id={`grade-received-${a.id}`} type="number" min="0" bind:value={drafts[a.id].received} class="grade-input" aria-label={`Grade received for ${a.title}`} />
                {:else}
                  <span class="grade-value">{a.gradeReceived ?? '—'}</span>
                {/if}
              </td>
              <td>
                {#if editingId === a.id}
                  <label class="sr-only" for={`grade-max-${a.id}`}>Maximum grade for {a.title}</label>
                  <input id={`grade-max-${a.id}`} type="number" min="0" bind:value={drafts[a.id].max} class="grade-input" aria-label={`Maximum grade for ${a.title}`} />
                {:else}
                  <span class="grade-value">{a.gradeMax ?? '—'}</span>
                {/if}
              </td>
              <td>
                {#if editingId === a.id}
                  <div class="row-actions">
                    <button type="button" class="btn btn-primary save-btn" onclick={() => saveGrade(a.id)} disabled={savingId === a.id} aria-label={`Save grade for ${a.title}`}>
                      {savingId === a.id ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" class="btn btn-secondary cancel-btn" onclick={() => cancelEditing(a)} disabled={savingId === a.id} aria-label={`Cancel editing ${a.title}`}>Cancel</button>
                  </div>
                {:else}
                  <button type="button" class="btn btn-secondary edit-btn" onclick={() => beginEditing(a.id)} aria-label={`Edit ${a.title}`}>Edit</button>
                {/if}
              </td>
            </tr>
            {#if feedback[a.id]}
              <tr class="feedback-row">
                <td colspan="7">{feedback[a.id]}</td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .course-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.25rem;
    box-shadow: var(--shadow-card);
  }
  .course-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.25rem;
  }
  /* Dense, repeated (one table per enrolled course on /grades) — sans
     escape hatch. */
  .course-header h2 { margin: 0; font-size: 1.05rem; font-family: var(--font-title, var(--font-display)); }
  .standing { font-weight: 700; }
  .reminder { color: var(--muted); font-size: 0.82rem; margin: 0 0 1rem 0; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th { text-align: left; padding: 0.4rem 0.5rem; color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--border); }
  td { padding: 0.5rem; border-bottom: 1px solid var(--hover); }
  tbody tr:hover td { background: var(--hover); }
  .capitalize { text-transform: capitalize; }
  .grade-input {
    width: 4.5rem;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    transition: border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease);
  }
  .grade-input:hover { border-color: var(--muted); }
  .grade-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 16%, transparent);
  }
  .save-btn { padding: 0.35rem 0.7rem; font-size: 0.82rem; }
  .edit-btn, .cancel-btn { padding: 0.35rem 0.7rem; font-size: 0.82rem; }
  .row-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .grade-value { display: inline-block; min-width: 4.5rem; }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .feedback-row td { color: var(--good-ink); font-size: 0.8rem; padding-top: 0; border-bottom: 1px solid var(--hover); }
</style>
