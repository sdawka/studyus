<script lang="ts">
  // v2.0: seeded exercise bank (courses/<slug>/exercises.json — see
  // courses/exercise-schema.md) rendered on the KC detail page. Fetches the
  // answer-stripped list from GET /kcs/:id/exercises and grades attempts
  // through POST /exercises/:id/attempt — this component never sees a
  // correct_index/answer/solution until the server hands one back post-grade.
  import { numericFieldValue, type NumericFieldBinding } from '../../lib/numericField';

  type McqDetails = { options: string[] };
  type NumericDetails = { unit: string | null };
  type WorkedDetails = { solution: string };

  type Exercise = {
    id: string;
    kind: 'mcq' | 'numeric' | 'worked';
    difficulty: 1 | 2 | 3;
    prompt: string;
    details: McqDetails | NumericDetails | WorkedDetails;
  };

  interface Props {
    kcId: string;
  }
  const { kcId }: Props = $props();

  let loading = $state(true);
  let loadError = $state(false);
  let exercises = $state<Exercise[]>([]);

  type McqState = { kind: 'mcq'; selected: number | null; graded?: { correct: boolean; correct_index: number; explanation: string } };
  type NumericState = { kind: 'numeric'; value: NumericFieldBinding; graded?: { correct: boolean; answer: { value: number; unit: string | null }; solution: string } };
  type WorkedState = { kind: 'worked'; revealed: boolean };
  type ItemState = (McqState | NumericState | WorkedState) & { submitting?: boolean; error?: string };

  const itemState = $state<Record<string, ItemState>>({});

  $effect(() => {
    loading = true;
    loadError = false;
    fetch(`/api/v1/kcs/${kcId}/exercises`)
      .then((res) => {
        if (!res.ok) throw new Error('load failed');
        return res.json();
      })
      .then((body) => {
        const rows = (body.data ?? []) as Exercise[];
        exercises = rows;
        for (const ex of rows) {
          if (ex.kind === 'mcq') itemState[ex.id] = { kind: 'mcq', selected: null };
          else if (ex.kind === 'numeric') itemState[ex.id] = { kind: 'numeric', value: '' };
          else itemState[ex.id] = { kind: 'worked', revealed: false };
        }
      })
      .catch(() => {
        loadError = true;
      })
      .finally(() => {
        loading = false;
      });
  });

  const mcqExercises = $derived(exercises.filter((e) => e.kind === 'mcq'));
  const numericExercises = $derived(exercises.filter((e) => e.kind === 'numeric'));
  const workedExercises = $derived(exercises.filter((e) => e.kind === 'worked'));

  async function submitMcq(ex: Exercise) {
    const state = itemState[ex.id] as McqState & { submitting?: boolean; error?: string };
    if (state.selected === null || state.submitting) return;
    state.submitting = true;
    state.error = undefined;
    try {
      const res = await fetch(`/api/v1/exercises/${ex.id}/attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_index: state.selected }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? 'Could not grade this attempt');
      state.graded = { correct: body.data.correct, correct_index: body.data.correct_index, explanation: body.data.explanation };
    } catch (err) {
      state.error = err instanceof Error ? err.message : 'Could not grade this attempt';
    } finally {
      state.submitting = false;
    }
  }

  async function submitNumeric(ex: Exercise) {
    const state = itemState[ex.id] as NumericState & { submitting?: boolean; error?: string };
    const value = numericFieldValue(state.value);
    if (value === null || state.submitting) return;
    state.submitting = true;
    state.error = undefined;
    try {
      const res = await fetch(`/api/v1/exercises/${ex.id}/attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? 'Could not grade this attempt');
      state.graded = { correct: body.data.correct, answer: body.data.answer, solution: body.data.solution };
    } catch (err) {
      state.error = err instanceof Error ? err.message : 'Could not grade this attempt';
    } finally {
      state.submitting = false;
    }
  }

  function difficultyLabel(d: 1 | 2 | 3): string {
    return `${'●'.repeat(d)}${'○'.repeat(3 - d)}`;
  }
</script>

<div class="exercises-section">
  {#if loading}
    <p class="placeholder">Loading exercises…</p>
  {:else if loadError}
    <p class="placeholder">Could not load exercises for this concept.</p>
  {:else if exercises.length === 0}
    <p class="placeholder">No exercises for this concept yet.</p>
  {:else}
    <div class="groups">
      {#if mcqExercises.length > 0}
        <div class="group">
          <h3>Multiple choice</h3>
          <ul class="exercise-list">
            {#each mcqExercises as ex (ex.id)}
              {@const state = itemState[ex.id] as McqState & { submitting?: boolean; error?: string }}
              <li class="exercise-card">
                <div class="card-top">
                  <p class="prompt">{ex.prompt}</p>
                  <span class="difficulty" title={`Difficulty ${ex.difficulty} of 3`}>{difficultyLabel(ex.difficulty)}</span>
                </div>
                <ul class="options">
                  {#each (ex.details as McqDetails).options as option, i (i)}
                    <li>
                      <button
                        type="button"
                        class="option"
                        class:selected={state.selected === i}
                        class:correct={state.graded && i === state.graded.correct_index}
                        class:incorrect={state.graded && state.selected === i && i !== state.graded.correct_index}
                        disabled={!!state.graded}
                        onclick={() => (state.selected = i)}
                      >
                        {option}
                      </button>
                    </li>
                  {/each}
                </ul>
                {#if !state.graded}
                  <button class="submit-btn" onclick={() => submitMcq(ex)} disabled={state.selected === null || state.submitting}>
                    {state.submitting ? 'Checking…' : 'Check answer'}
                  </button>
                  {#if state.error}<p class="error">{state.error}</p>{/if}
                {:else}
                  <p class="feedback" class:is-correct={state.graded.correct}>
                    {state.graded.correct ? 'Correct.' : 'Not quite.'} {state.graded.explanation}
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if numericExercises.length > 0}
        <div class="group">
          <h3>Numeric practice</h3>
          <ul class="exercise-list">
            {#each numericExercises as ex (ex.id)}
              {@const state = itemState[ex.id] as NumericState & { submitting?: boolean; error?: string }}
              <li class="exercise-card">
                <div class="card-top">
                  <p class="prompt">{ex.prompt}</p>
                  <span class="difficulty" title={`Difficulty ${ex.difficulty} of 3`}>{difficultyLabel(ex.difficulty)}</span>
                </div>
                {#if !state.graded}
                  <div class="numeric-input-row">
                    <input
                      type="number"
                      step="any"
                      bind:value={state.value}
                      placeholder="Your answer"
                      disabled={state.submitting}
                    />
                    {#if (ex.details as NumericDetails).unit}<span class="unit">{(ex.details as NumericDetails).unit}</span>{/if}
                    <button class="submit-btn" onclick={() => submitNumeric(ex)} disabled={state.submitting}>
                      {state.submitting ? 'Checking…' : 'Check answer'}
                    </button>
                  </div>
                  {#if state.error}<p class="error">{state.error}</p>{/if}
                {:else}
                  <p class="feedback" class:is-correct={state.graded.correct}>
                    {state.graded.correct ? 'Correct.' : 'Not quite.'} Answer: {state.graded.answer.value}{state.graded.answer.unit ? ` ${state.graded.answer.unit}` : ''}
                  </p>
                  <p class="solution">{state.graded.solution}</p>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if workedExercises.length > 0}
        <div class="group">
          <h3>Worked examples</h3>
          <ul class="exercise-list">
            {#each workedExercises as ex (ex.id)}
              {@const state = itemState[ex.id] as WorkedState}
              <li class="exercise-card">
                <div class="card-top">
                  <p class="prompt">{ex.prompt}</p>
                  <span class="difficulty" title={`Difficulty ${ex.difficulty} of 3`}>{difficultyLabel(ex.difficulty)}</span>
                </div>
                {#if state.revealed}
                  <p class="solution">{(ex.details as WorkedDetails).solution}</p>
                {:else}
                  <button class="submit-btn" onclick={() => (state.revealed = true)}>Show solution</button>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .exercises-section { min-width: 0; }
  .placeholder { color: var(--muted); font-size: 0.9rem; }

  .groups { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.75rem; }
  .group { min-width: 0; }
  .group h3 { font-size: 0.85rem; margin: 0 0 0.7rem 0; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }

  .exercise-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.8rem; }
  .exercise-card {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  .card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.8rem; }
  .prompt { margin: 0; font-size: 0.92rem; line-height: 1.45; min-width: 0; }
  .difficulty { flex: 0 0 auto; font-size: 0.7rem; color: var(--muted); letter-spacing: 0.1em; }

  .options { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .option {
    display: block;
    width: 100%;
    text-align: left;
    background: var(--surface-2, transparent);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem 0.7rem;
    font-size: 0.87rem;
    color: var(--text);
    cursor: pointer;
    transition: border-color var(--motion-fast) var(--ease), background var(--motion-fast) var(--ease);
  }
  .option:hover:not(:disabled) { border-color: var(--accent); }
  .option:disabled { cursor: default; }
  .option.selected { border-color: var(--accent); background: var(--hover); }
  .option.correct { border-color: var(--good); }
  .option.incorrect { border-color: var(--danger); }

  .numeric-input-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .numeric-input-row input {
    width: 10ch;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-size: 0.88rem;
  }
  .unit { font-size: 0.8rem; color: var(--muted); }

  .submit-btn {
    align-self: flex-start;
    background: var(--accent);
    color: var(--surface);
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.45rem 0.9rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .submit-btn:disabled { opacity: 0.5; cursor: default; }

  .feedback { margin: 0; font-size: 0.87rem; color: var(--text); }
  .feedback.is-correct { color: var(--good-ink); }
  .solution { margin: 0; font-size: 0.85rem; color: var(--muted); white-space: pre-wrap; }
  .error { margin: 0; font-size: 0.82rem; color: var(--danger-ink); }
</style>
