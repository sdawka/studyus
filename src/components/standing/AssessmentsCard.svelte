<script lang="ts">
  // v1.4: assessments split by `kind` — official rows are the graded table
  // (weights, grade entry, count toward the weighted grade server-side);
  // practice rows are a quieter group below with no weight column, since
  // they don't count toward anything. Kept in one card because they're the
  // same underlying list a student manages, just visually distinct.
  const ASSESSMENT_TYPES = ['quiz', 'assignment', 'midterm', 'final', 'lab'] as const;

  // v1.4: Q-matrix linking moves into this card as a "Concepts covered"
  // chip-picker in both add and edit forms — see courseKcs below for the
  // lazy-fetch source.
  import { courseContext } from '../../lib/stores/courseContext';

  interface Assessment {
    id: string;
    title: string;
    type: string;
    kind: 'official' | 'practice';
    due_date: string | null;
    weight_pct: number | null;
    grade_received: number | null;
    grade_max: number | null;
    kc_ids: string[];
  }

  interface Kc {
    id: string;
    name: string;
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
  let draftKcIds = $state<Set<string>>(new Set());
  let addSaving = $state(false);
  let addError = $state<string | null>(null);

  // Concepts-covered picker: lazily fetched once (on first add-open or
  // edit-open) and shared by both forms. `null` = not yet fetched;
  // `[]` = fetched, course has no KCs. Reused across add/edit rather than
  // re-fetched per form.
  let courseKcs = $state<Kc[] | null>(null);
  let kcsLoading = $state(false);
  let kcsLoadError = $state<string | null>(null);

  // Chosen source: `/api/v1/courses/:slug` (the same branches+kcs endpoint
  // StandingTab already calls) via the slug already sitting in the
  // courseContext store (set by CourseLayout's CourseContextSetter for this
  // exact course) — no new endpoint, no new StandingTab prop. Falls back to
  // an empty list (picker just shows nothing) if the context hasn't matched
  // yet, which shouldn't happen in practice since this only fires on a user
  // click well after mount.
  async function ensureKcsLoaded() {
    if (courseKcs !== null || kcsLoading) return;
    kcsLoading = true;
    kcsLoadError = null;
    try {
      const ctx = $courseContext;
      const slug = ctx && ctx.id === courseId ? ctx.slug : null;
      if (!slug) {
        kcsLoadError = 'Could not resolve course.';
        courseKcs = [];
        return;
      }
      const res = await fetch(`/api/v1/courses/${slug}`);
      if (!res.ok) {
        kcsLoadError = 'Could not load concepts.';
        courseKcs = [];
        return;
      }
      const course = (await res.json()).data;
      const branches: { kcs: Kc[] }[] = course.branches ?? [];
      courseKcs = branches.flatMap((b) => b.kcs.map((k) => ({ id: k.id, name: k.name })));
    } catch {
      kcsLoadError = 'Network error.';
      courseKcs = [];
    } finally {
      kcsLoading = false;
    }
  }

  function toggleDraftKc(id: string) {
    const next = new Set(draftKcIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    draftKcIds = next;
  }

  function openAdd() {
    closeEdit();
    addOpen = true;
    void ensureKcsLoaded();
  }

  let editingId = $state<string | null>(null);
  let editDraft = $state<{ title: string; type: string; due: string; weight: string; kcIds: Set<string> } | null>(null);
  let editSaving = $state(false);
  let editError = $state<string | null>(null);

  function openEdit(a: Assessment) {
    addOpen = false;
    editingId = a.id;
    editDraft = {
      title: a.title,
      type: a.type,
      due: a.due_date ? a.due_date.slice(0, 10) : '',
      weight: a.weight_pct !== null ? String(a.weight_pct) : '',
      kcIds: new Set(a.kc_ids),
    };
    editError = null;
    void ensureKcsLoaded();
  }

  function closeEdit() {
    editingId = null;
    editDraft = null;
    editError = null;
  }

  function toggleEditKc(id: string) {
    if (!editDraft) return;
    const next = new Set(editDraft.kcIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    editDraft = { ...editDraft, kcIds: next };
  }

  async function submitEdit(e: Event, a: Assessment) {
    e.preventDefault();
    if (!editDraft || !editDraft.title.trim()) return;
    editSaving = true;
    editError = null;
    try {
      const body: Record<string, unknown> = {
        title: editDraft.title.trim(),
        type: editDraft.type,
        due_date: editDraft.due ? new Date(`${editDraft.due}T12:00:00`).toISOString() : null,
        kc_ids: [...editDraft.kcIds],
      };
      if (a.kind === 'official') body.weight_pct = editDraft.weight === '' ? null : Number(editDraft.weight);
      const res = await fetch(`/api/v1/assessments/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        editError = json?.error?.message ?? 'Could not save.';
        return;
      }
      const updated = json.data;
      assessments = assessments.map((row) =>
        row.id === a.id
          ? {
              ...row,
              title: updated.title,
              type: updated.type,
              due_date: updated.due_date,
              weight_pct: updated.weight_pct,
              kc_ids: updated.kc_ids,
            }
          : row,
      );
      closeEdit();
    } catch {
      editError = 'Network error.';
    } finally {
      editSaving = false;
    }
  }

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
      if (draftKcIds.size > 0) body.kc_ids = [...draftKcIds];
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
      draftKcIds = new Set();
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
              <td class="row-actions">
                <button type="button" class="btn btn-secondary" onclick={() => saveGrade(a.id)} disabled={gradeSavingId === a.id}>
                  {gradeSavingId === a.id ? 'Saving…' : 'Save'}
                </button>
                <button type="button" class="link-btn" onclick={() => (editingId === a.id ? closeEdit() : openEdit(a))}>
                  {editingId === a.id ? 'Close' : 'Edit'}
                </button>
              </td>
            </tr>
            {#if gradeFeedback[a.id]}
              <tr class="feedback-row"><td colspan="7">{gradeFeedback[a.id]}</td></tr>
            {/if}
            {#if editingId === a.id && editDraft}
              <tr class="edit-row">
                <td colspan="7">
                  <form class="edit-form" onsubmit={(e) => submitEdit(e, a)}>
                    <div class="add-row">
                      <input type="text" placeholder="Title" bind:value={editDraft.title} disabled={editSaving} />
                      <select bind:value={editDraft.type} disabled={editSaving}>
                        {#each ASSESSMENT_TYPES as t}
                          <option value={t}>{t}</option>
                        {/each}
                      </select>
                    </div>
                    <div class="add-row">
                      <input type="number" min="0" max="100" placeholder="Weight %" bind:value={editDraft.weight} disabled={editSaving} class="weight-input" />
                      <input type="date" bind:value={editDraft.due} disabled={editSaving} />
                    </div>
                    <div class="kc-section">
                      <p class="kicker">Concepts covered</p>
                      {#if kcsLoading}
                        <p class="kc-status">Loading concepts…</p>
                      {:else if kcsLoadError}
                        <p class="kc-status error">{kcsLoadError}</p>
                      {:else if courseKcs && courseKcs.length === 0}
                        <p class="kc-status">No concepts defined for this course yet.</p>
                      {:else if courseKcs}
                        <div class="kc-picker">
                          {#each courseKcs as kc (kc.id)}
                            <button type="button" class="chip" aria-pressed={editDraft.kcIds.has(kc.id)} onclick={() => toggleEditKc(kc.id)}>{kc.name}</button>
                          {/each}
                        </div>
                      {/if}
                    </div>
                    <div class="add-row">
                      <button type="submit" class="btn btn-primary" disabled={editSaving || !editDraft.title.trim()}>{editSaving ? 'Saving…' : 'Save'}</button>
                      <button type="button" class="btn btn-secondary" disabled={editSaving} onclick={closeEdit}>Cancel</button>
                    </div>
                    {#if editError}<p class="error">{editError}</p>{/if}
                  </form>
                </td>
              </tr>
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
            <div class="practice-row">
              <span class="practice-title">{p.title}</span>
              {#if p.grade_received !== null}
                <span class="practice-score num">{p.grade_received}/{p.grade_max ?? 100}</span>
                <button type="button" class="link-btn" disabled={practiceSavingId === p.id} onclick={() => setPracticeDone(p, false)}>Undo</button>
              {:else}
                <button type="button" class="link-btn" disabled={practiceSavingId === p.id} onclick={() => setPracticeDone(p, true)}>Mark done</button>
              {/if}
              <button type="button" class="link-btn" onclick={() => (editingId === p.id ? closeEdit() : openEdit(p))}>
                {editingId === p.id ? 'Close' : 'Edit'}
              </button>
            </div>
            {#if editingId === p.id && editDraft}
              <form class="edit-form" onsubmit={(e) => submitEdit(e, p)}>
                <div class="add-row">
                  <input type="text" placeholder="Title" bind:value={editDraft.title} disabled={editSaving} />
                  <select bind:value={editDraft.type} disabled={editSaving}>
                    {#each ASSESSMENT_TYPES as t}
                      <option value={t}>{t}</option>
                    {/each}
                  </select>
                  <input type="date" bind:value={editDraft.due} disabled={editSaving} />
                </div>
                <div class="kc-section">
                  <p class="kicker">Concepts covered</p>
                  {#if kcsLoading}
                    <p class="kc-status">Loading concepts…</p>
                  {:else if kcsLoadError}
                    <p class="kc-status error">{kcsLoadError}</p>
                  {:else if courseKcs && courseKcs.length === 0}
                    <p class="kc-status">No concepts defined for this course yet.</p>
                  {:else if courseKcs}
                    <div class="kc-picker">
                      {#each courseKcs as kc (kc.id)}
                        <button type="button" class="chip" aria-pressed={editDraft.kcIds.has(kc.id)} onclick={() => toggleEditKc(kc.id)}>{kc.name}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
                <div class="add-row">
                  <button type="submit" class="btn btn-primary" disabled={editSaving || !editDraft.title.trim()}>{editSaving ? 'Saving…' : 'Save'}</button>
                  <button type="button" class="btn btn-secondary" disabled={editSaving} onclick={closeEdit}>Cancel</button>
                </div>
                {#if editError}<p class="error">{editError}</p>{/if}
              </form>
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
        <div class="kc-section">
          <p class="kicker">Concepts covered</p>
          {#if kcsLoading}
            <p class="kc-status">Loading concepts…</p>
          {:else if kcsLoadError}
            <p class="kc-status error">{kcsLoadError}</p>
          {:else if courseKcs && courseKcs.length === 0}
            <p class="kc-status">No concepts defined for this course yet.</p>
          {:else if courseKcs}
            <div class="kc-picker">
              {#each courseKcs as kc (kc.id)}
                <button type="button" class="chip" aria-pressed={draftKcIds.has(kc.id)} onclick={() => toggleDraftKc(kc.id)}>{kc.name}</button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="add-row">
          <button type="submit" class="btn btn-primary" disabled={addSaving || !draftTitle.trim()}>{addSaving ? 'Adding…' : 'Add'}</button>
          <button type="button" class="btn btn-secondary" disabled={addSaving} onclick={() => (addOpen = false)}>Cancel</button>
        </div>
        {#if addError}<p class="error">{addError}</p>{/if}
      </form>
    {:else}
      <button type="button" class="link-btn add-btn" onclick={openAdd}>+ Add assessment</button>
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
  .row-actions { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
  .feedback-row td { color: var(--good); font-size: 12px; padding-top: 0; }
  .edit-row td { padding-top: var(--space-4); padding-bottom: var(--space-4); background: var(--hairline); }
  .error { color: var(--danger); font-size: 12px; margin: 0; }

  .edit-form { display: flex; flex-direction: column; gap: var(--space-2); }

  .kc-section { display: flex; flex-direction: column; gap: 6px; }
  .kc-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 140px;
    overflow-y: auto;
    padding: 2px;
  }
  .kc-status { font-size: 12px; color: var(--muted); margin: 0; }
  .kc-status.error { color: var(--danger); }

  .practice-group {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }
  .group-label { margin: 0 0 var(--space-2); }
  .practice-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .practice-list li { padding: 4px 0; }
  .practice-list li > .edit-form { margin: 6px 0 4px; }
  .practice-row {
    display: flex;
    align-items: center;
    gap: 10px;
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
