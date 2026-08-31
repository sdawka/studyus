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
  import { apiFetch } from '../../lib/apiClient';
  import { formatDueDate } from '../../lib/plannerDates';
  import { courseContext } from '../../lib/stores/courseContext';
  import { numericFieldValue, type NumericFieldBinding } from '../../lib/numericField';

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
  let { courseId, assessments: serverAssessments, onGraded, onPracticeChange }: Props = $props();

  // The prop is the source of truth, not a seed. CourseHome refetches the
  // course's assessments and re-passes them after every grade save, and that
  // refresh has to win — a `$state` copy forked at mount silently ignored it.
  //
  // Local mutations (add, edit, grade, practice toggle) are an optimistic
  // overlay tagged with the prop array they were computed from, so the next
  // array from the parent discards them rather than being discarded by them.
  let overlay = $state.raw<{ base: Assessment[]; rows: Assessment[] } | null>(null);
  const assessments = $derived(overlay !== null && overlay.base === serverAssessments ? overlay.rows : serverAssessments);

  function setAssessments(rows: Assessment[]) {
    overlay = { base: serverAssessments, rows };
  }

  function patchAssessment(id: string, patch: Partial<Assessment>) {
    setAssessments(assessments.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  // Grade entry is the one piece of genuinely local editable state here: it is
  // the user's in-progress typing, seeded once from the row and owned by the
  // input from then on. Instances are memoized per assessment id in a plain
  // (non-reactive) Map, so a row that only appears later — added here, or
  // arriving in a refreshed prop — still gets a draft on first render.
  class GradeDraft {
    received = $state<NumericFieldBinding>('');
    max = $state<NumericFieldBinding>('');
    constructor(a: Assessment) {
      this.received = a.grade_received?.toString() ?? '';
      this.max = a.grade_max?.toString() ?? '';
    }
  }
  const gradeDrafts = new Map<string, GradeDraft>();
  function gradeDraftFor(a: Assessment): GradeDraft {
    let draft = gradeDrafts.get(a.id);
    if (!draft) {
      draft = new GradeDraft(a);
      gradeDrafts.set(a.id, draft);
    }
    return draft;
  }

  // Keyed by assessment id: several rows can be saving at once, and a scalar
  // here re-enabled a row's Save button as soon as a *different* row started.
  let gradeSavingIds = $state<ReadonlySet<string>>(new Set());
  let gradeFeedback = $state<Record<string, string>>({});
  let practiceSavingIds = $state<ReadonlySet<string>>(new Set());

  const officialAssessments = $derived(assessments.filter((a) => a.kind !== 'practice'));
  const practiceAssessments = $derived(assessments.filter((a) => a.kind === 'practice'));

  let addOpen = $state(false);
  let draftTitle = $state('');
  let draftType = $state<string>('quiz');
  let draftKind = $state<'official' | 'practice'>('official');
  let draftWeight = $state<NumericFieldBinding>('');
  let draftDue = $state('');
  let draftKcIds = $state<Set<string>>(new Set());
  let addSaving = $state(false);
  let addError = $state<string | null>(null);

  // Concepts-covered picker: lazily fetched on first add-open or edit-open and
  // shared by both forms rather than re-fetched per form. `null` = not loaded
  // (never fetched, or the last attempt failed); `[]` = fetched, course has no
  // KCs — the two render different messages.
  let courseKcs = $state<Kc[] | null>(null);
  let kcsLoading = $state(false);
  let kcsLoadError = $state<string | null>(null);

  // Chosen source: `/api/v1/courses/:slug` (the same branches+kcs endpoint
  // StandingTab already calls) via the slug already sitting in the
  // courseContext store (set by CourseLayout's CourseContextSetter for this
  // exact course) — no new endpoint, no new StandingTab prop. An unmatched
  // context is reported like any other failure (and is retryable), rather than
  // silently presenting as "this course has no concepts".
  //
  // A failure leaves `courseKcs` null — "not loaded", which is exactly what it
  // is. Parking [] there instead made the failure terminal: the not-yet-fetched
  // guard below was permanently satisfied, so no reopen and no retry ever
  // fetched again for the life of the component.
  async function loadKcs() {
    if (kcsLoading) return;
    kcsLoading = true;
    kcsLoadError = null;
    try {
      const ctx = $courseContext;
      const slug = ctx && ctx.id === courseId ? ctx.slug : null;
      if (!slug) {
        kcsLoadError = 'Could not resolve course.';
        return;
      }
      const result = await apiFetch<{ branches?: { kcs: Kc[] }[] }>(`/api/v1/courses/${slug}`, {}, 'Could not load concepts.', 'Network error.');
      if (!result.ok) {
        // A non-ok response always shows this fixed message (ignoring
        // whatever the server said); only a true network failure shows its
        // own message — matches the pre-apiFetch behavior here.
        kcsLoadError = result.reason === 'network' ? result.error : 'Could not load concepts.';
        return;
      }
      const branches: { kcs: Kc[] }[] = result.data.branches ?? [];
      courseKcs = branches.flatMap((b) => b.kcs.map((k) => ({ id: k.id, name: k.name })));
    } finally {
      kcsLoading = false;
    }
  }

  function ensureKcsLoaded() {
    if (courseKcs !== null) return;
    void loadKcs();
  }

  function retryKcs() {
    void loadKcs();
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
    ensureKcsLoaded();
  }

  let editingId = $state<string | null>(null);
  let editDraft = $state<{ title: string; type: string; due: string; weight: NumericFieldBinding; kcIds: Set<string> } | null>(null);
  // The id being saved, not a boolean: the user can open another row's form
  // while a save is in flight, and that row must not inherit this state.
  let editSavingId = $state<string | null>(null);
  let editError = $state<string | null>(null);
  // True only while the form currently on screen is the one saving.
  const editBusy = $derived(editSavingId !== null && editSavingId === editingId);

  function withId(ids: ReadonlySet<string>, id: string, present: boolean): ReadonlySet<string> {
    const next = new Set(ids);
    if (present) next.add(id);
    else next.delete(id);
    return next;
  }

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
    ensureKcsLoaded();
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
    if (!editDraft || !editDraft.title.trim() || editSavingId) return;
    editSavingId = a.id;
    editError = null;
    try {
      const body: Record<string, unknown> = {
        title: editDraft.title.trim(),
        type: editDraft.type,
        due_date: editDraft.due ? new Date(`${editDraft.due}T12:00:00`).toISOString() : null,
        kc_ids: [...editDraft.kcIds],
      };
      if (a.kind === 'official') body.weight_pct = numericFieldValue(editDraft.weight);
      const result = await apiFetch<{
        title: string;
        type: string;
        due_date: string | null;
        weight_pct: number | null;
        kc_ids: string[];
      }>(
        `/api/v1/assessments/${a.id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        'Could not save.',
        'Network error.',
      );
      if (!result.ok) {
        // The user may have switched to another row while this was in flight;
        // only surface the error on the form that produced it.
        if (editingId === a.id) editError = result.error;
        return;
      }
      const updated = result.data;
      patchAssessment(a.id, {
        title: updated.title,
        type: updated.type,
        due_date: updated.due_date,
        weight_pct: updated.weight_pct,
        kc_ids: updated.kc_ids,
      });
      if (editingId === a.id) closeEdit();
    } finally {
      editSavingId = null;
    }
  }

  async function saveGrade(assessment: Assessment) {
    const assessmentId = assessment.id;
    if (gradeSavingIds.has(assessmentId)) return;
    const draft = gradeDraftFor(assessment);
    gradeSavingIds = withId(gradeSavingIds, assessmentId, true);
    gradeFeedback = { ...gradeFeedback, [assessmentId]: '' };
    try {
      const result = await apiFetch<{ grade_received: number | null; grade_max: number | null; mastery_deltas?: unknown[] }>(
        `/api/v1/assessments/${assessmentId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grade_received: numericFieldValue(draft.received),
            grade_max: numericFieldValue(draft.max),
          }),
        },
        'Save failed',
        'Network error.',
      );
      if (!result.ok) {
        gradeFeedback = { ...gradeFeedback, [assessmentId]: result.error };
        return;
      }
      const updated = result.data;
      patchAssessment(assessmentId, { grade_received: updated.grade_received, grade_max: updated.grade_max });
      const logged = Array.isArray(updated.mastery_deltas) && updated.mastery_deltas.length > 0;
      gradeFeedback = { ...gradeFeedback, [assessmentId]: logged ? 'Saved — logged an event for linked concepts.' : 'Saved.' };
      onGraded?.();
    } finally {
      gradeSavingIds = withId(gradeSavingIds, assessmentId, false);
    }
  }

  // Practice rows don't need a real score to be "done" — a plain
  // completion mark is enough; a student who does want to log an actual
  // score can still edit the underlying assessment elsewhere.
  async function setPracticeDone(assessment: Assessment, done: boolean) {
    if (practiceSavingIds.has(assessment.id)) return;
    practiceSavingIds = withId(practiceSavingIds, assessment.id, true);
    const prev = { grade_received: assessment.grade_received, grade_max: assessment.grade_max };
    const next = done
      ? { grade_received: assessment.grade_received ?? 100, grade_max: assessment.grade_max ?? 100 }
      : { grade_received: null, grade_max: assessment.grade_max };
    patchAssessment(assessment.id, next);
    try {
      // Either failure mode (non-ok response or the request never landing)
      // reverts identically, so there's nothing left for a catch to do.
      const result = await apiFetch(`/api/v1/assessments/${assessment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!result.ok) {
        patchAssessment(assessment.id, prev);
      } else {
        onPracticeChange?.();
      }
    } finally {
      practiceSavingIds = withId(practiceSavingIds, assessment.id, false);
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
      const draftWeightValue = numericFieldValue(draftWeight);
      if (draftKind === 'official' && draftWeightValue !== null) body.weight_pct = draftWeightValue;
      if (draftDue) body.due_date = new Date(`${draftDue}T12:00:00`).toISOString();
      if (draftKcIds.size > 0) body.kc_ids = [...draftKcIds];
      const result = await apiFetch<Assessment>(
        `/api/v1/courses/${courseId}/assessments`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        'Could not add assessment.',
        'Network error.',
      );
      if (!result.ok) {
        addError = result.error;
        // The error only renders inside the add form, and opening Edit closes
        // that form. Reopen it so the failure is visible — the draft fields are
        // untouched on failure, so the user's input is still there to retry.
        addOpen = true;
        closeEdit();
        return;
      }
      setAssessments([...assessments, result.data]);
      if (draftKind === 'practice') onPracticeChange?.();
      addOpen = false;
      draftTitle = '';
      draftType = 'quiz';
      draftKind = 'official';
      draftWeight = '';
      draftDue = '';
      draftKcIds = new Set();
    } finally {
      addSaving = false;
    }
  }
</script>

<section class="card">
  <div class="card-head">
    <h2 class="card-title">Assessments</h2>
  </div>
  <p class="hint">Entering a grade automatically logs an assessment event for any concepts linked to it. Only official assessments count toward your weighted grade.</p>
  {#if officialAssessments.length === 0}
    <p class="empty">No official assessments yet.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Title</th><th>Type</th><th>Due</th><th>Weight</th><th>Grade</th><th>Out of</th><th></th></tr>
        </thead>
        <tbody>
          {#each officialAssessments as a (a.id)}
            {@const draft = gradeDraftFor(a)}
            <tr>
              <td>{a.title}</td>
              <td class="capitalize">{a.type}</td>
              <td>{formatDueDate(a.due_date)}</td>
              <td class="num">{a.weight_pct !== null ? `${a.weight_pct}%` : '—'}</td>
              <td><input type="number" min="0" bind:value={draft.received} class="grade-input num" /></td>
              <td><input type="number" min="0" bind:value={draft.max} class="grade-input num" /></td>
              <td class="row-actions">
                <button type="button" class="btn btn-secondary" onclick={() => saveGrade(a)} disabled={gradeSavingIds.has(a.id)}>
                  {gradeSavingIds.has(a.id) ? 'Saving…' : 'Save'}
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
                      <input type="text" placeholder="Title" bind:value={editDraft.title} disabled={editBusy} />
                      <select bind:value={editDraft.type} disabled={editBusy}>
                        {#each ASSESSMENT_TYPES as t}
                          <option value={t}>{t}</option>
                        {/each}
                      </select>
                    </div>
                    <div class="add-row">
                      <input type="number" min="0" max="100" placeholder="Weight %" bind:value={editDraft.weight} disabled={editBusy} class="weight-input" />
                      <input type="date" bind:value={editDraft.due} disabled={editBusy} />
                    </div>
                    <div class="kc-section">
                      <p class="kicker">Concepts covered</p>
                      {#if kcsLoading}
                        <p class="kc-status">Loading concepts…</p>
                      {:else if kcsLoadError}
                        <div class="kc-status-row">
                          <p class="kc-status error">{kcsLoadError}</p>
                          <button type="button" class="link-btn" onclick={retryKcs}>Retry</button>
                        </div>
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
                      <button type="submit" class="btn btn-primary" disabled={editBusy || !editDraft.title.trim()}>{editBusy ? 'Saving…' : 'Save'}</button>
                      <button type="button" class="btn btn-secondary" disabled={editBusy} onclick={closeEdit}>Cancel</button>
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
                <button type="button" class="link-btn" disabled={practiceSavingIds.has(p.id)} onclick={() => setPracticeDone(p, false)}>Undo</button>
              {:else}
                <button type="button" class="link-btn" disabled={practiceSavingIds.has(p.id)} onclick={() => setPracticeDone(p, true)}>Mark done</button>
              {/if}
              <button type="button" class="link-btn" onclick={() => (editingId === p.id ? closeEdit() : openEdit(p))}>
                {editingId === p.id ? 'Close' : 'Edit'}
              </button>
            </div>
            {#if editingId === p.id && editDraft}
              <form class="edit-form" onsubmit={(e) => submitEdit(e, p)}>
                <div class="add-row">
                  <input type="text" placeholder="Title" bind:value={editDraft.title} disabled={editBusy} />
                  <select bind:value={editDraft.type} disabled={editBusy}>
                    {#each ASSESSMENT_TYPES as t}
                      <option value={t}>{t}</option>
                    {/each}
                  </select>
                  <input type="date" bind:value={editDraft.due} disabled={editBusy} />
                </div>
                <div class="kc-section">
                  <p class="kicker">Concepts covered</p>
                  {#if kcsLoading}
                    <p class="kc-status">Loading concepts…</p>
                  {:else if kcsLoadError}
                    <div class="kc-status-row">
                      <p class="kc-status error">{kcsLoadError}</p>
                      <button type="button" class="link-btn" onclick={retryKcs}>Retry</button>
                    </div>
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
                  <button type="submit" class="btn btn-primary" disabled={editBusy || !editDraft.title.trim()}>{editBusy ? 'Saving…' : 'Save'}</button>
                  <button type="button" class="btn btn-secondary" disabled={editBusy} onclick={closeEdit}>Cancel</button>
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
            <div class="kc-status-row">
              <p class="kc-status error">{kcsLoadError}</p>
              <button type="button" class="link-btn" onclick={retryKcs}>Retry</button>
            </div>
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
  .kc-status-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

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

    /* Add/edit forms share `.add-row` — the title input takes its own
       full line, letting type/date/weight wrap to the next. */
    .add-row input[type='text'] {
      flex: 1 1 100%;
      min-width: 0;
    }
  }
</style>
