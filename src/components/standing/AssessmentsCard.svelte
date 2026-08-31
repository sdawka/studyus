<script lang="ts">
  // v1.4: assessments split by `kind` — official rows are the graded table
  // (weights, grade entry, count toward the weighted grade server-side);
  // practice rows are a quieter group below with no weight column, since
  // they don't count toward anything. Kept in one card because they're the
  // same underlying list a student manages, just visually distinct.
  //
  // This file is the card's coordinator, and holds the three things the pieces
  // below it cannot each hold separately: the list of rows, the one open edit
  // session, and the one add session. Everything that talks to /api/v1 lives
  // here too, so the child components stay views over state plus callbacks.
  import { apiFetch } from '../../lib/apiClient';
  import { numericFieldValue } from '../../lib/numericField';
  import { dateOnlyInputToIso } from '../../lib/dateField';
  import {
    emptyAddDraft,
    type AddAssessmentDraft,
    type Assessment,
    type AssessmentFormDraft,
    type EditSession,
    type GradeEntry,
  } from '../../lib/assessments';
  import { CourseKcsSource } from '../../lib/courseKcs.svelte';
  import OfficialAssessmentsTable from './OfficialAssessmentsTable.svelte';
  import PracticeAssessmentsList from './PracticeAssessmentsList.svelte';
  import AddAssessmentForm from './AddAssessmentForm.svelte';

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

  const officialAssessments = $derived(assessments.filter((a) => a.kind !== 'practice'));
  const practiceAssessments = $derived(assessments.filter((a) => a.kind === 'practice'));

  // v1.4: Q-matrix linking lives in this card as a "Concepts covered" chip
  // picker in both the add and the edit form, over one shared source.
  const kcSource = new CourseKcsSource(() => courseId);

  // Both keyed by assessment id: several rows can be saving at once, and a
  // scalar here re-enabled a row's Save button as soon as a *different* row
  // started, and surfaced its errors on whichever row was on screen.
  let gradeSavingIds = $state<ReadonlySet<string>>(new Set());
  let gradeFeedback = $state<Record<string, string>>({});
  let practiceSavingIds = $state<ReadonlySet<string>>(new Set());

  function withId(ids: ReadonlySet<string>, id: string, present: boolean): ReadonlySet<string> {
    const next = new Set(ids);
    if (present) next.add(id);
    else next.delete(id);
    return next;
  }

  // --- the add session ------------------------------------------------------
  // The draft outlives the form on purpose: Cancel only hides it, and reopening
  // shows what was already typed. It is cleared on a successful add, and kept
  // on a failure so the user can retry without retyping.
  let addOpen = $state(false);
  let addDraft = $state<AddAssessmentDraft>(emptyAddDraft());
  let addSaving = $state(false);
  let addError = $state<string | null>(null);

  function openAdd() {
    closeEdit();
    addOpen = true;
    kcSource.ensureLoaded();
  }

  async function submitAdd() {
    if (!addDraft.title.trim()) return;
    addSaving = true;
    addError = null;
    try {
      const body: Record<string, unknown> = {
        title: addDraft.title.trim(),
        type: addDraft.type,
        kind: addDraft.kind,
      };
      const weight = numericFieldValue(addDraft.weight);
      if (addDraft.kind === 'official' && weight !== null) body.weight_pct = weight;
      // An unparseable date degrades to "no due date", the same as an empty
      // one — due_date is optional, so there is nothing to block the save on.
      const addDueIso = dateOnlyInputToIso(addDraft.due);
      if (addDueIso !== null) body.due_date = addDueIso;
      if (addDraft.kcIds.size > 0) body.kc_ids = [...addDraft.kcIds];
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
      if (addDraft.kind === 'practice') onPracticeChange?.();
      addOpen = false;
      addDraft = emptyAddDraft();
    } finally {
      addSaving = false;
    }
  }

  // --- the edit session -----------------------------------------------------
  // Only ever one row's form is open, whether that row is in the official table
  // or the practice list, so the two render it from this one session. The
  // fields being typed into belong to the form component; what is tracked here
  // is which row is open and what its save is doing.
  let editingId = $state<string | null>(null);
  // The id being saved, not a boolean: the user can open another row's form
  // while a save is in flight, and that row must not inherit this state.
  let editSavingId = $state<string | null>(null);
  let editError = $state<string | null>(null);

  function openEdit(a: Assessment) {
    addOpen = false;
    editingId = a.id;
    editError = null;
    kcSource.ensureLoaded();
  }

  function closeEdit() {
    editingId = null;
    editError = null;
  }

  async function submitEdit(a: Assessment, draft: AssessmentFormDraft) {
    if (!draft.title.trim() || editSavingId) return;
    editSavingId = a.id;
    editError = null;
    try {
      const body: Record<string, unknown> = {
        title: draft.title.trim(),
        type: draft.type,
        due_date: dateOnlyInputToIso(draft.due),
        kc_ids: [...draft.kcIds],
      };
      if (a.kind === 'official') body.weight_pct = numericFieldValue(draft.weight);
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
      // Tell the parent, whichever form it came from: an official row's weight
      // and concepts feed the weighted grade, a practice row's title and
      // concepts feed the practice card. Neither used to be notified, so both
      // views sat stale behind an edit that had already succeeded.
      if (a.kind === 'practice') onPracticeChange?.();
      else onGraded?.();
    } finally {
      editSavingId = null;
    }
  }

  const editSession: EditSession = {
    get openId() {
      return editingId;
    },
    // True only while the form currently on screen is the one saving.
    get busy() {
      return editSavingId !== null && editSavingId === editingId;
    },
    get error() {
      return editError;
    },
    toggle: (a) => (editingId === a.id ? closeEdit() : openEdit(a)),
    submit: submitEdit,
    cancel: closeEdit,
  };

  // --- row-level saves ------------------------------------------------------
  async function saveGrade(a: Assessment, entry: GradeEntry) {
    if (gradeSavingIds.has(a.id)) return;
    gradeSavingIds = withId(gradeSavingIds, a.id, true);
    gradeFeedback = { ...gradeFeedback, [a.id]: '' };
    try {
      const result = await apiFetch<{ grade_received: number | null; grade_max: number | null; mastery_deltas?: unknown[] }>(
        `/api/v1/assessments/${a.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grade_received: numericFieldValue(entry.received),
            grade_max: numericFieldValue(entry.max),
          }),
        },
        'Save failed',
        'Network error.',
      );
      if (!result.ok) {
        gradeFeedback = { ...gradeFeedback, [a.id]: result.error };
        return;
      }
      const updated = result.data;
      patchAssessment(a.id, { grade_received: updated.grade_received, grade_max: updated.grade_max });
      const logged = Array.isArray(updated.mastery_deltas) && updated.mastery_deltas.length > 0;
      gradeFeedback = { ...gradeFeedback, [a.id]: logged ? 'Saved — logged an event for linked concepts.' : 'Saved.' };
      onGraded?.();
    } finally {
      gradeSavingIds = withId(gradeSavingIds, a.id, false);
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
</script>

<section class="card">
  <div class="card-head">
    <h2 class="card-title">Assessments</h2>
  </div>
  <p class="hint">Entering a grade automatically logs an assessment event for any concepts linked to it. Only official assessments count toward your weighted grade.</p>
  {#if officialAssessments.length === 0}
    <p class="empty">No official assessments yet.</p>
  {:else}
    <OfficialAssessmentsTable
      rows={officialAssessments}
      savingIds={gradeSavingIds}
      feedback={gradeFeedback}
      edit={editSession}
      {kcSource}
      onSaveGrade={saveGrade}
    />
  {/if}

  {#if practiceAssessments.length > 0}
    <PracticeAssessmentsList
      rows={practiceAssessments}
      savingIds={practiceSavingIds}
      edit={editSession}
      {kcSource}
      onSetDone={setPracticeDone}
    />
  {/if}

  <div class="card-footer">
    {#if addOpen}
      <AddAssessmentForm
        bind:draft={addDraft}
        saving={addSaving}
        error={addError}
        {kcSource}
        onSubmit={submitAdd}
        onCancel={() => (addOpen = false)}
      />
    {:else}
      <button type="button" class="link-btn add-btn" onclick={openAdd}>+ Add assessment</button>
    {/if}
  </div>
</section>

<style>
  .hint { color: var(--muted); font-size: 12.5px; margin: 0 0 var(--space-4); }
  .card-footer { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--hairline); }
  .link-btn { background: none; color: var(--accent); font-size: 12.5px; font-weight: 550; padding: 2px 0; }
  .link-btn:hover { text-decoration: underline; }
  .add-btn { align-self: flex-start; }
</style>
