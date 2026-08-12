<script lang="ts">
  // v1.4: assessments split by `kind` — official rows are the graded table
  // (weights, grade entry, count toward the weighted grade server-side);
  // practice rows are a quieter group below with no weight column, since
  // they don't count toward anything. Kept in one card because they're the
  // same underlying list a student manages, just visually distinct.
  const ASSESSMENT_TYPES = ['quiz', 'assignment', 'midterm', 'final', 'lab'] as const;

  interface Assessment {
    id: string;
    title: string;
    type: string;
    kind: 'official' | 'practice';
    due_date: string | null;
    weight_pct: number | null;
    grade_received: number | null;
    grade_max: number | null;
  }

  interface Props {
    courseId: string;
    assessments: Assessment[];
    onGraded?: () => void;
    onPracticeChange?: () => void;
  }
  let { courseId, assessments: initialAssessments, onGraded, onPracticeChange }: Props = $props();

  let assessments = $state(initialAssessments);
  let gradeDrafts = $state<Record<string, { received: string; max: string }>>(
    Object.fromEntries(
      assessments.map((a) => [a.id, { received: a.grade_received?.toString() ?? '', max: a.grade_max?.toString() ?? '' }]),
    ),
  );
  let gradeSavingId = $state<string | null>(null);
  let gradeFeedback = $state<Record<string, string>>({});
  let practiceSavingId = $state<string | null>(null);

  const officialAssessments = $derived(assessments.filter((a) => a.kind !== 'practice'));
  const practiceAssessments = $derived(assessments.filter((a) => a.kind === 'practice'));

  let addOpen = $state(false);
  let draftTitle = $state('');
  let draftType = $state<string>('quiz');
  let draftKind = $state<'official' | 'practice'>('official');
  let draftWeight = $state('');
  let draftDue = $state('');
  let addSaving = $state(false);
  let addError = $state<string | null>(null);

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

  // Practice rows don't need a real score to be "done" — a plain
  // completion mark is enough; a student who does want to log an actual
  // score can still edit the underlying assessment elsewhere.
  async function setPracticeDone(assessment: Assessment, done: boolean) {
    practiceSavingId = assessment.id;
    const prev = { grade_received: assessment.grade_received, grade_max: assessment.grade_max };
    const next = done
      ? { grade_received: assessment.grade_received ?? 100, grade_max: assessment.grade_max ?? 100 }
      : { grade_received: null, grade_max: assessment.grade_max };
    assessments = assessments.map((a) => (a.id === assessment.id ? { ...a, ...next } : a));
    try {
      const res = await fetch(`/api/v1/assessments/${assessment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        assessments = assessments.map((a) => (a.id === assessment.id ? { ...a, ...prev } : a));
      } else {
        onPracticeChange?.();
      }
    } catch {
      assessments = assessments.map((a) => (a.id === assessment.id ? { ...a, ...prev } : a));
    } finally {
      practiceSavingId = null;
    }
  }

  async function submitAdd(e: Event) {
    e.preventDefault();
    if (!draftTitle.trim()) return;
    addSaving = true;
    addError = null;
    try {
      const body: Record<string, unknown> = {
        title: draftTitle.trim(),
        type: draftType,
        kind: draftKind,
      };
      if (draftKind === 'official' && draftWeight !== '') body.weight_pct = Number(draftWeight);
      if (draftDue) body.due_date = new Date(`${draftDue}T12:00:00`).toISOString();
      const res = await fetch(`/api/v1/courses/${courseId}/assessments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        addError = json?.error?.message ?? 'Could not add assessment.';
        return;
      }
      assessments = [...assessments, json.data];
      gradeDrafts = { ...gradeDrafts, [json.data.id]: { received: '', max: '' } };
      if (draftKind === 'practice') onPracticeChange?.();
      addOpen = false;
      draftTitle = '';
      draftType = 'quiz';
      draftKind = 'official';
      draftWeight = '';
      draftDue = '';
    } catch {
      addError = 'Network error.';
    } finally {
      addSaving = false;
    }
  }
</script>

<section class="card">
  <div class="card-head">
    <h2 class="card-title">Assessments</h2>
  </div>
  <p class="hint">Entering a grade automatically logs an event for any KCs linked to it. Only official assessments count toward your weighted grade.</p>
  {#if officialAssessments.length === 0}
    <p class="empty">No official assessments yet.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Title</th><th>Type</th><th>Due</th><th>Weight</th><th>Grade</th><th>Out of</th><th></th></tr>
        </thead>
        <tbody>
          {#each officialAssessments as a}
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

  {#if practiceAssessments.length > 0}
    <div class="practice-group">
      <p class="group-label kicker">Practice — doesn't count toward your grade</p>
      <ul class="practice-list">
        {#each practiceAssessments as p (p.id)}
          <li>
            <span class="practice-title">{p.title}</span>
            {#if p.grade_received !== null}
              <span class="practice-score num">{p.grade_received}/{p.grade_max ?? 100}</span>
              <button type="button" class="link-btn" disabled={practiceSavingId === p.id} onclick={() => setPracticeDone(p, false)}>Undo</button>
            {:else}
              <button type="button" class="link-btn" disabled={practiceSavingId === p.id} onclick={() => setPracticeDone(p, true)}>Mark done</button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="card-footer">
    {#if addOpen}
      <form class="add-form" onsubmit={submitAdd}>
        <div class="add-row">
          <input type="text" placeholder="Title" bind:value={draftTitle} disabled={addSaving} />
          <select bind:value={draftType} disabled={addSaving}>
            {#each ASSESSMENT_TYPES as t}
              <option value={t}>{t}</option>
            {/each}
          </select>
        </div>
        <div class="add-row">
          <div class="kind-toggle" role="group" aria-label="Counts toward grade">
            <button type="button" class:active={draftKind === 'official'} onclick={() => (draftKind = 'official')}>Official</button>
            <button type="button" class:active={draftKind === 'practice'} onclick={() => (draftKind = 'practice')}>Practice</button>
          </div>
          {#if draftKind === 'official'}
            <input type="number" min="0" max="100" placeholder="Weight %" bind:value={draftWeight} disabled={addSaving} class="weight-input" />
          {/if}
          <input type="date" bind:value={draftDue} disabled={addSaving} />
        </div>
        <div class="add-row">
          <button type="submit" class="btn btn-primary" disabled={addSaving || !draftTitle.trim()}>{addSaving ? 'Adding…' : 'Add'}</button>
          <button type="button" class="btn btn-secondary" disabled={addSaving} onclick={() => (addOpen = false)}>Cancel</button>
        </div>
        {#if addError}<p class="error">{addError}</p>{/if}
      </form>
    {:else}
      <button type="button" class="link-btn add-btn" onclick={() => (addOpen = true)}>+ Add assessment</button>
    {/if}
  </div>
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
  .error { color: var(--danger); font-size: 12px; margin: 0; }

  .practice-group {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }
  .group-label { margin: 0 0 var(--space-2); }
  .practice-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .practice-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    font-size: 13px;
    color: var(--muted);
  }
  .practice-title { flex: 1; min-width: 0; color: var(--text); }
  .practice-score { color: var(--muted); }

  .card-footer { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--hairline); }
  .link-btn { background: none; color: var(--accent); font-size: 12.5px; font-weight: 550; padding: 2px 0; }
  .link-btn:hover { text-decoration: underline; }
  .link-btn:disabled { opacity: 0.5; pointer-events: none; }
  .add-btn { align-self: flex-start; }

  .add-form { display: flex; flex-direction: column; gap: var(--space-2); }
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
</style>
