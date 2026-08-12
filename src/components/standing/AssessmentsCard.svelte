<script lang="ts">
  interface Assessment {
    id: string;
    title: string;
    type: string;
    due_date: string | null;
    weight_pct: number | null;
    grade_received: number | null;
    grade_max: number | null;
  }

  interface Props {
    assessments: Assessment[];
    onGraded?: () => void;
  }
  let { assessments: initialAssessments, onGraded }: Props = $props();

  let assessments = $state(initialAssessments);
  let gradeDrafts = $state<Record<string, { received: string; max: string }>>(
    Object.fromEntries(
      assessments.map((a) => [a.id, { received: a.grade_received?.toString() ?? '', max: a.grade_max?.toString() ?? '' }]),
    ),
  );
  let gradeSavingId = $state<string | null>(null);
  let gradeFeedback = $state<Record<string, string>>({});

  function formatDate(iso: string | null): string {
    if (!iso) return 'No due date';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async function saveGrade(assessmentId: string) {
    const draft = gradeDrafts[assessmentId];
    if (!draft) return;
    gradeSavingId = assessmentId;
    gradeFeedback = { ...gradeFeedback, [assessmentId]: '' };
    try {
      const res = await fetch(`/api/v1/assessments/${assessmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grade_received: draft.received === '' ? null : Number(draft.received),
          grade_max: draft.max === '' ? null : Number(draft.max),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        gradeFeedback = { ...gradeFeedback, [assessmentId]: json?.error?.message ?? 'Save failed' };
        return;
      }
      const updated = json.data;
      assessments = assessments.map((a) =>
        a.id === assessmentId ? { ...a, grade_received: updated.grade_received, grade_max: updated.grade_max } : a,
      );
      const logged = Array.isArray(updated.mastery_deltas) && updated.mastery_deltas.length > 0;
      gradeFeedback = { ...gradeFeedback, [assessmentId]: logged ? 'Saved — logged an event for linked KCs.' : 'Saved.' };
      onGraded?.();
    } catch {
      gradeFeedback = { ...gradeFeedback, [assessmentId]: 'Network error.' };
    } finally {
      gradeSavingId = null;
    }
  }
</script>

<section class="card">
  <div class="card-head">
    <h2 class="card-title">Assessments</h2>
  </div>
  <p class="hint">Entering a grade automatically logs an event for any KCs linked to it.</p>
  {#if assessments.length === 0}
    <p class="empty">No assessments yet.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Title</th><th>Type</th><th>Due</th><th>Weight</th><th>Grade</th><th>Out of</th><th></th></tr>
        </thead>
        <tbody>
          {#each assessments as a}
            <tr>
              <td>{a.title}</td>
              <td class="capitalize">{a.type}</td>
              <td>{formatDate(a.due_date)}</td>
              <td class="num">{a.weight_pct !== null ? `${a.weight_pct}%` : '—'}</td>
              <td><input type="number" min="0" bind:value={gradeDrafts[a.id].received} class="grade-input num" /></td>
              <td><input type="number" min="0" bind:value={gradeDrafts[a.id].max} class="grade-input num" /></td>
              <td>
                <button type="button" class="btn btn-secondary" onclick={() => saveGrade(a.id)} disabled={gradeSavingId === a.id}>
                  {gradeSavingId === a.id ? 'Saving…' : 'Save'}
                </button>
              </td>
            </tr>
            {#if gradeFeedback[a.id]}
              <tr class="feedback-row"><td colspan="7">{gradeFeedback[a.id]}</td></tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .hint { color: var(--muted); font-size: 12.5px; margin: 0 0 var(--space-4); }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th { text-align: left; padding: 6px 8px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--hairline); }
  td { padding: 8px; border-bottom: 1px solid var(--hairline); }
  .capitalize { text-transform: capitalize; }
  .grade-input { width: 4.5rem; padding: 5px 7px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
  .feedback-row td { color: var(--good); font-size: 12px; padding-top: 0; }
</style>
