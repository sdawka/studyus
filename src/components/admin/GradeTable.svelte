<script lang="ts">
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
  let drafts = $state<Record<string, { received: string; max: string }>>(
    Object.fromEntries(
      initialAssessments.map((a) => [a.id, { received: a.gradeReceived?.toString() ?? '', max: a.gradeMax?.toString() ?? '' }]),
    ),
  );
  let savingId = $state<string | null>(null);
  let feedback = $state<Record<string, string>>({});

  function formatDue(ms: number | null): string {
    if (ms === null) return 'No due date';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async function saveGrade(assessmentId: string) {
    const draft = drafts[assessmentId];
    if (!draft) return;
    savingId = assessmentId;
    feedback = { ...feedback, [assessmentId]: '' };
    try {
      const body: Record<string, number | null> = {};
      body.grade_received = draft.received === '' ? null : Number(draft.received);
      body.grade_max = draft.max === '' ? null : Number(draft.max);
      const res = await fetch(`/api/v1/assessments/${assessmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        feedback = { ...feedback, [assessmentId]: json?.error?.message ?? 'Save failed' };
        return;
      }
      const updated = json.data;
      assessments = assessments.map((a) =>
        a.id === assessmentId ? { ...a, gradeReceived: updated.grade_received, gradeMax: updated.grade_max } : a,
      );
      const loggedEvent = Array.isArray(updated.mastery_deltas) && updated.mastery_deltas.length > 0;
      feedback = { ...feedback, [assessmentId]: loggedEvent ? 'Saved — logged a grade event for linked KCs.' : 'Saved.' };
    } catch {
      feedback = { ...feedback, [assessmentId]: 'Network error, please try again.' };
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
  <p class="reminder">Entering a grade automatically logs an assessment event for any KCs linked to it.</p>

  {#if assessments.length === 0}
    <p class="muted">No assessments yet for this course.</p>
  {:else}
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
              <input type="number" min="0" bind:value={drafts[a.id].received} class="grade-input" />
            </td>
            <td>
              <input type="number" min="0" bind:value={drafts[a.id].max} class="grade-input" />
            </td>
            <td>
              <button type="button" onclick={() => saveGrade(a.id)} disabled={savingId === a.id}>
                {savingId === a.id ? 'Saving…' : 'Save'}
              </button>
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
  {/if}
</div>

<style>
  .course-panel {
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    margin-bottom: 1.25rem;
  }
  .course-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.25rem;
  }
  .course-header h2 { margin: 0; font-size: 1.05rem; }
  .standing { font-weight: 700; }
  .reminder { color: #6b7280; font-size: 0.82rem; margin: 0 0 1rem 0; }
  .muted { color: #6b7280; font-size: 0.9rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th { text-align: left; padding: 0.4rem 0.5rem; color: #6b7280; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid #e5e7eb; }
  td { padding: 0.5rem; border-bottom: 1px solid #f0f2f5; }
  .capitalize { text-transform: capitalize; }
  .grade-input { width: 4.5rem; padding: 0.3rem 0.4rem; border: 1px solid #e5e7eb; border-radius: 6px; }
  button {
    background: #3f6fd8;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.35rem 0.7rem;
    font-size: 0.82rem;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .feedback-row td { color: #15803d; font-size: 0.8rem; padding-top: 0; border-bottom: 1px solid #f0f2f5; }
</style>
