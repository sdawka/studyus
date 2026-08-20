<script lang="ts">
  // Rituals CRUD + adherence on /profile. Props contract (frozen ahead of
  // this track landing):
  //
  //   rituals: RitualResponse[] | null  (src/lib/schemas/rituals.ts — each
  //     row already carries its `adherence` block, see ritualResponseSchema)
  //
  // `null` means the server hasn't wired listRitualsWithAdherence into
  // profile.astro yet — this panel self-loads via GET /api/v1/rituals in
  // that case, so it works standalone regardless of when that TODO there
  // gets flipped over to the real service call.
  //
  // Anti-gamification (vision.md): adherence is shown as plain counts and a
  // done/skipped/upcoming dot row — no streaks, no badges, no "broken
  // chain" language, and 'skipped' is always the word used, never 'missed'.
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/apiClient';
  import { pushToast } from '../../lib/stores/toast';
  import type { RitualCadence, RitualKind, RitualResponse, RitualStepKind } from '../../lib/schemas/rituals';

  interface Props {
    rituals: RitualResponse[] | null;
  }
  const { rituals: initialRituals }: Props = $props();

  let rituals = $state<RitualResponse[]>(initialRituals ?? []);
  let loading = $state(initialRituals === null);
  let loadError = $state<string | null>(null);

  onMount(async () => {
    if (initialRituals !== null) return;
    const res = await apiFetch<RitualResponse[]>('/api/v1/rituals', {}, 'Could not load rituals');
    loading = false;
    if (!res.ok) {
      loadError = res.error;
      return;
    }
    rituals = res.data;
  });

  const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const STEP_KIND_LABELS: Record<RitualStepKind, string> = {
    game: 'Game',
    warmup: 'Warm-up',
    retrieval: 'Retrieval practice',
    new_material: 'New material',
    reflect: 'Reflect',
    break: 'Break',
  };

  function parseWeekdays(raw: string | null): number[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
    } catch {
      return [];
    }
  }

  function cadenceSummary(r: RitualResponse): string {
    if (!r.cadence) return 'No schedule set';
    if (r.cadence === 'daily') return 'Daily';
    if (r.cadence === 'weekly') {
      const days = parseWeekdays(r.by_weekday).sort((a, b) => a - b);
      const names = days.map((d) => WEEKDAY_LABELS[d - 1]).filter(Boolean);
      return names.length ? `Weekly · ${names.join('/')}` : 'Weekly';
    }
    if (r.cadence === 'after_class') return 'After class';
    return 'Before class';
  }

  function kindLabel(kind: RitualKind): string {
    if (kind === 'recurring') return 'Recurring';
    if (kind === 'session_shape') return 'Session shape';
    return 'Recurring + session shape';
  }

  function adherenceLine(r: RitualResponse): string | null {
    const { generated_28d, done_28d } = r.adherence;
    if (generated_28d === 0) return null;
    return `${done_28d} of ${generated_28d} done in the last 4 weeks`;
  }

  function formatDotDate(date: string): string {
    return new Date(`${date}T12:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const DAY_MS = 86_400_000;

  type AdherenceSlot = { date: string; state: 'done' | 'skipped' | 'upcoming'; real: boolean };

  // The API only sends real occurrence dots (however many actually exist
  // in the 28-day window — a brand-new weekly ritual may have just one),
  // so a sparse array on its own renders as a lone floating dot with no
  // sense of scale. Fill in the rest of the 28-day window with unfilled
  // placeholder ticks (styled the same as a real 'upcoming' dot) so the
  // row always reads as a fixed 4-week axis, real occurrences positioned
  // among them by date.
  function buildAdherenceAxis(occurrences: { date: string; state: 'done' | 'skipped' | 'upcoming' }[]): AdherenceSlot[] {
    const byDate = new Map(occurrences.map((o) => [o.date, o]));
    const todayStr = new Date().toISOString().slice(0, 10);
    const base = new Date(`${todayStr}T00:00:00.000Z`).getTime();
    const slots: AdherenceSlot[] = [];
    for (let i = 27; i >= 0; i--) {
      const date = new Date(base - i * DAY_MS).toISOString().slice(0, 10);
      const occ = byDate.get(date);
      slots.push({ date, state: occ?.state ?? 'upcoming', real: !!occ });
    }
    return slots;
  }

  // ---------------------------------------------------------------------
  // Create form
  // ---------------------------------------------------------------------
  let showForm = $state(false);
  let name = $state('');
  let description = $state('');
  let kind = $state<RitualKind>('recurring');
  let cadence = $state<Extract<RitualCadence, 'daily' | 'weekly'> | ''>('daily');
  let selectedWeekdays = $state<number[]>([]);
  let steps = $state<{ kind: RitualStepKind; label: string; minutes: string }[]>([]);
  let newStepKind = $state<RitualStepKind>('warmup');
  let saving = $state(false);
  let formError = $state<string | null>(null);

  // after_class/before_class need a course_id this panel isn't given (see
  // props contract above) — a course-scoped ritual can still be created
  // via the API directly; the create form here only offers the two
  // course-independent cadences.
  const CADENCE_OPTIONS: { value: 'daily' | 'weekly'; label: string }[] = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
  ];

  function toggleWeekday(day: number) {
    selectedWeekdays = selectedWeekdays.includes(day)
      ? selectedWeekdays.filter((d) => d !== day)
      : [...selectedWeekdays, day].sort((a, b) => a - b);
  }

  function addStep() {
    steps = [...steps, { kind: newStepKind, label: '', minutes: '' }];
  }

  function removeStep(index: number) {
    steps = steps.filter((_, i) => i !== index);
  }

  function resetForm() {
    name = '';
    description = '';
    kind = 'recurring';
    cadence = 'daily';
    selectedWeekdays = [];
    steps = [];
    formError = null;
  }

  function openForm() {
    resetForm();
    showForm = true;
  }

  function closeForm() {
    showForm = false;
  }

  const includesRecurring = $derived(kind === 'recurring' || kind === 'both');
  const includesShape = $derived(kind === 'session_shape' || kind === 'both');

  async function submitForm() {
    formError = null;
    if (!name.trim()) {
      formError = 'Name is required.';
      return;
    }
    if (includesRecurring && cadence === 'weekly' && selectedWeekdays.length === 0) {
      formError = 'Pick at least one day for a weekly ritual.';
      return;
    }

    const body: Record<string, unknown> = {
      name: name.trim(),
      kind,
    };
    if (description.trim()) body.description = description.trim();
    if (includesRecurring && cadence) {
      body.cadence = cadence;
      if (cadence === 'weekly') body.by_weekday = JSON.stringify(selectedWeekdays);
    }
    if (includesShape && steps.length > 0) {
      body.steps = steps.map((s) => ({
        kind: s.kind,
        ...(s.label.trim() ? { label: s.label.trim() } : {}),
        ...(s.minutes.trim() ? { minutes: Number(s.minutes) } : {}),
      }));
    }

    saving = true;
    const res = await apiFetch<RitualResponse>(
      '/api/v1/rituals',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      'Could not create that ritual right now.',
    );
    saving = false;
    if (!res.ok) {
      formError = res.error;
      return;
    }
    rituals = [...rituals, res.data];
    pushToast('Ritual created.', 'success');
    showForm = false;
  }

  // ---------------------------------------------------------------------
  // Per-row actions
  // ---------------------------------------------------------------------
  let togglingId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);
  let deletingId = $state<string | null>(null);

  async function toggleActive(r: RitualResponse) {
    togglingId = r.id;
    const res = await apiFetch<RitualResponse>(
      `/api/v1/rituals/${r.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !r.active }) },
      'Could not update that ritual right now.',
    );
    togglingId = null;
    if (!res.ok) {
      pushToast(res.error, 'error');
      return;
    }
    rituals = rituals.map((x) => (x.id === r.id ? res.data : x));
  }

  function requestDelete(id: string) {
    confirmingDeleteId = id;
  }

  function cancelDelete() {
    confirmingDeleteId = null;
  }

  async function confirmDelete(id: string) {
    deletingId = id;
    const res = await apiFetch(`/api/v1/rituals/${id}`, { method: 'DELETE' }, 'Could not delete that ritual right now.');
    deletingId = null;
    confirmingDeleteId = null;
    if (!res.ok) {
      pushToast(res.error, 'error');
      return;
    }
    rituals = rituals.filter((x) => x.id !== id);
    pushToast('Ritual deleted.', 'success');
  }
</script>

<section class="card">
  <div class="head">
    <h2>Rituals</h2>
    <button type="button" class="add-btn" onclick={openForm}>Add ritual</button>
  </div>
  <p class="stepdesc">
    Recurring study practices and in-session structure — set up once, tracked as done/skipped/upcoming, never as a
    streak to protect.
  </p>

  {#if loading}
    <p class="muted">Loading rituals…</p>
  {:else if loadError}
    <p class="error">{loadError}</p>
  {:else if rituals.length === 0 && !showForm}
    <p class="muted">No rituals yet. Add one to build a recurring practice or shape your study sessions.</p>
  {:else}
    <ul class="ritual-list">
      {#each rituals as r (r.id)}
        <li class="ritual-row" class:inactive={!r.active}>
          <div class="row-head">
            <span class="row-name">{r.name}</span>
            <span class="kind-tag">{kindLabel(r.kind)}</span>
            {#if !r.active}<span class="inactive-tag">Paused</span>{/if}
          </div>
          {#if r.description}<p class="row-desc">{r.description}</p>{/if}

          {#if r.kind === 'recurring' || r.kind === 'both'}
            <p class="cadence">{cadenceSummary(r)}</p>
            {#if r.adherence.occurrences.length > 0}
              <div class="dot-row" role="list" aria-label="Last 4 weeks">
                {#each buildAdherenceAxis(r.adherence.occurrences) as slot (slot.date)}
                  <span
                    class="dot dot-{slot.state}"
                    role="listitem"
                    title={slot.real ? `${formatDotDate(slot.date)} — ${slot.state}` : formatDotDate(slot.date)}
                  ></span>
                {/each}
              </div>
            {/if}
            {#if adherenceLine(r)}
              <p class="adherence-line">{adherenceLine(r)}</p>
            {:else}
              <p class="adherence-line muted">No occurrences yet.</p>
            {/if}
          {/if}

          {#if r.kind === 'session_shape' || r.kind === 'both'}
            {#if r.steps && r.steps.length > 0}
              <ol class="step-chips">
                {#each r.steps as s, i (i)}
                  <li class="step-chip">
                    {STEP_KIND_LABELS[s.kind]}{#if s.minutes} · {s.minutes}m{/if}
                  </li>
                {/each}
              </ol>
            {/if}
            <p class="adherence-line">
              Used to start {r.adherence.session_uses_28d}
              {r.adherence.session_uses_28d === 1 ? 'session' : 'sessions'} in the last 4 weeks
            </p>
          {/if}

          <div class="row-actions">
            <label class="active-toggle">
              <input
                type="checkbox"
                checked={r.active}
                disabled={togglingId === r.id}
                onchange={() => toggleActive(r)}
              />
              Active
            </label>
            {#if confirmingDeleteId === r.id}
              <span class="confirm-row">
                <span class="confirm-prompt">Delete this ritual?</span>
                <button type="button" class="confirm-yes" disabled={deletingId === r.id} onclick={() => confirmDelete(r.id)}>
                  {deletingId === r.id ? 'Deleting…' : 'Yes'}
                </button>
                <button type="button" class="confirm-no" disabled={deletingId === r.id} onclick={cancelDelete}>Cancel</button>
              </span>
            {:else}
              <button type="button" class="delete-btn" onclick={() => requestDelete(r.id)}>Delete</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if showForm}
    <div class="form-card">
      <h3>New ritual</h3>
      {#if formError}<p class="error">{formError}</p>{/if}

      <label class="field">
        Name
        <input type="text" bind:value={name} maxlength="200" placeholder="Sunday weekly review" />
      </label>

      <label class="field">
        Description (optional)
        <textarea bind:value={description} rows="2" maxlength="2000"></textarea>
      </label>

      <label class="field">
        Kind
        <select bind:value={kind}>
          <option value="recurring">Recurring — a scheduled practice</option>
          <option value="session_shape">Session shape — in-session structure</option>
          <option value="both">Both</option>
        </select>
      </label>

      {#if includesRecurring}
        <label class="field">
          Cadence
          <select bind:value={cadence}>
            {#each CADENCE_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>

        {#if cadence === 'weekly'}
          <div class="weekday-picker">
            {#each WEEKDAY_LABELS as label, i (label)}
              <button
                type="button"
                class="weekday-chip"
                class:active={selectedWeekdays.includes(i + 1)}
                onclick={() => toggleWeekday(i + 1)}
              >
                {label}
              </button>
            {/each}
          </div>
        {/if}
      {/if}

      {#if includesShape}
        <div class="steps-builder">
          <p class="steps-label">Step rail</p>
          {#each steps as step, i (i)}
            <div class="step-row">
              <span class="step-kind-label">{STEP_KIND_LABELS[step.kind]}</span>
              <input type="text" placeholder="Label (optional)" bind:value={step.label} maxlength="200" />
              <input type="number" min="1" placeholder="min" bind:value={step.minutes} class="minutes-input" />
              <button type="button" class="remove-step" onclick={() => removeStep(i)} aria-label="Remove step">×</button>
            </div>
          {/each}
          <div class="add-step-row">
            <select bind:value={newStepKind}>
              {#each Object.entries(STEP_KIND_LABELS) as [value, label] (value)}
                <option {value}>{label}</option>
              {/each}
            </select>
            <button type="button" class="ghost" onclick={addStep}>Add step</button>
          </div>
        </div>
      {/if}

      <div class="form-actions">
        <button type="button" class="primary" disabled={saving} onclick={submitForm}>
          {saving ? 'Saving…' : 'Create ritual'}
        </button>
        <button type="button" class="ghost" onclick={closeForm}>Cancel</button>
      </div>
    </div>
  {/if}
</section>

<style>
  section.card { margin-bottom: 1.75rem; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; }
  .card h2 { font-size: 1.05rem; margin: 0 0 1rem; }
  .stepdesc { color: var(--muted); font-size: 0.88rem; max-width: 620px; margin: 0 0 1rem; }
  .muted { color: var(--muted); font-size: 0.88rem; }
  .error { color: var(--danger); font-size: 0.88rem; }

  .add-btn {
    border: 1px solid var(--border);
    background: var(--hover);
    color: var(--text);
    border-radius: 8px;
    padding: 0.4rem 0.8rem;
    font-size: 0.84rem;
    font-weight: 550;
    cursor: pointer;
  }

  .ritual-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.8rem; }
  .ritual-row {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    background: var(--surface);
  }
  .ritual-row.inactive { opacity: 0.7; }

  .row-head { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .row-name { font-weight: 600; font-size: 0.96rem; }
  .kind-tag {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.1rem 0.4rem;
  }
  .inactive-tag { font-size: 0.72rem; color: var(--muted); font-style: italic; }
  .row-desc { margin: 0; font-size: 0.86rem; color: var(--muted); }
  .cadence { margin: 0; font-size: 0.85rem; }

  .dot-row { display: flex; gap: 3px; flex-wrap: wrap; }
  .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .dot-done { background: var(--good-ink, #2f9e58); }
  .dot-skipped { background: var(--border); }
  .dot-upcoming { background: var(--accent-soft, #cfe0ff); border: 1px solid var(--accent); }

  .adherence-line { margin: 0; font-size: 0.82rem; color: var(--muted); }

  .step-chips { list-style: none; margin: 0; padding: 0; display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .step-chip {
    font-size: 0.76rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.15rem 0.6rem;
    color: var(--text);
  }

  .row-actions { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.2rem; }
  .active-toggle { display: flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; color: var(--muted); }
  .active-toggle input { accent-color: var(--accent); cursor: pointer; }

  button { border: none; cursor: pointer; font-size: 0.84rem; font-weight: 550; border-radius: 8px; padding: 0.4rem 0.75rem; }
  button:disabled { opacity: 0.6; cursor: default; }
  .delete-btn { background: none; color: var(--muted); margin-left: auto; }
  .confirm-row { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }
  .confirm-prompt { font-size: 0.82rem; color: var(--muted); }
  .confirm-yes { background: var(--danger, #c0392b); color: #fff; }
  .confirm-no { background: none; color: var(--muted); }

  .form-card {
    margin-top: 1rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    max-width: 520px;
  }
  .form-card h3 { margin: 0; font-size: 0.95rem; }
  .field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.86rem; color: var(--text); }
  .field input[type='text'],
  .field input[type='number'],
  .field select,
  .field textarea {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-family: inherit;
    font-size: 0.86rem;
    background: var(--surface);
    color: var(--text);
  }

  .weekday-picker { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .weekday-chip {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    border-radius: 999px;
    padding: 0.3rem 0.65rem;
    font-size: 0.8rem;
  }
  .weekday-chip.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); }

  .steps-builder { display: flex; flex-direction: column; gap: 0.5rem; }
  .steps-label { margin: 0; font-size: 0.82rem; color: var(--muted); }
  .step-row { display: flex; align-items: center; gap: 0.4rem; }
  .step-row input[type='text'] { flex: 1; }
  .minutes-input { width: 60px; }
  .remove-step { background: none; color: var(--muted); padding: 0.2rem 0.5rem; font-size: 1rem; }
  .add-step-row { display: flex; gap: 0.5rem; align-items: center; }

  .form-actions { display: flex; gap: 0.6rem; }
  .primary { background: var(--accent); color: var(--surface); }
  .ghost { background: var(--hover); color: var(--text); }

  @container (max-width: 480px) {
    .row-head { flex-direction: column; align-items: flex-start; gap: 0.2rem; }
    .step-row { flex-wrap: wrap; }
  }
</style>
