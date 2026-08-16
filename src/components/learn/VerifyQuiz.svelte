<script lang="ts">
  // Minimal MCQ flow scoped to explicit kc_ids (docs/api.md's "Flows —
  // quick_quiz explicit KC targeting", v1.7) — a purpose-built subset of
  // QuickQuiz.svelte's quiz-taking loop (course/count pickers don't apply
  // here; the KC set is already decided by which prereqs came back
  // `ready:false` from the graph). Auto-starts on mount since there's no
  // setup step to show.
  import { apiFetch } from '../../lib/apiClient';
  import { pushToast } from '../../lib/stores/toast';

  type Question = { index: number; kc_id: string; question: string; options: string[] };
  type Result = { question_index: number; kc_id: string; correct: boolean; correct_index: number; explanation: string };
  type MasteryDelta = { kc_id: string; old_mastery: number; new_mastery: number };

  interface Props {
    kcIds: string[];
    onDone: () => void;
    onCancel: () => void;
  }
  const { kcIds, onDone, onCancel }: Props = $props();

  let stage = $state<'loading' | 'quiz' | 'grading' | 'score' | 'error'>('loading');
  let quizId = $state<string | null>(null);
  let questions = $state<Question[]>([]);
  let current = $state(0);
  let answers = $state<Record<number, number>>({});
  let results = $state<Result[]>([]);
  let score = $state(0);
  let masteryDeltas = $state<MasteryDelta[]>([]);
  let errorMessage = $state<string | null>(null);

  async function start() {
    stage = 'loading';
    const res = await apiFetch<{ id: string; questions: Question[] }>(
      '/api/v1/flows/quick_quiz',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kc_ids: kcIds }) },
      'Could not start the verification quiz right now.',
    );
    if (!res.ok) {
      errorMessage = res.error;
      stage = 'error';
      pushToast(res.error, 'error');
      return;
    }
    quizId = res.data.id;
    questions = res.data.questions;
    current = 0;
    answers = {};
    stage = 'quiz';
  }

  start();

  function selectOption(index: number) {
    answers = { ...answers, [current]: index };
  }

  function next() {
    if (current < questions.length - 1) current += 1;
    else submit();
  }

  async function submit() {
    stage = 'grading';
    const res = await apiFetch<{ score: number; results: Result[]; mastery_deltas: MasteryDelta[] }>(
      `/api/v1/flows/quick_quiz/${quizId}/answers`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: Object.entries(answers).map(([index, selected]) => ({ question_index: Number(index), selected_index: selected })),
        }),
      },
      'Could not grade the quiz.',
    );
    if (!res.ok) {
      errorMessage = res.error;
      stage = 'error';
      pushToast(res.error, 'error');
      return;
    }
    score = res.data.score;
    results = res.data.results;
    masteryDeltas = res.data.mastery_deltas;
    stage = 'score';
  }
</script>

<div class="verify-quiz">
  {#if stage === 'loading'}
    <p class="status">Preparing your verification quiz…</p>
  {:else if stage === 'quiz'}
    {#if questions[current]}
      <p class="progress">Question {current + 1} of {questions.length}</p>
      <h3>{questions[current].question}</h3>
      <div class="options">
        {#each questions[current].options as opt, i}
          <button type="button" class="option" class:selected={answers[current] === i} onclick={() => selectOption(i)}>
            {opt}
          </button>
        {/each}
      </div>
      <div class="row-actions">
        <button type="button" class="btn-secondary" onclick={onCancel}>Back to prereqs</button>
        <button type="button" class="btn-primary" onclick={next} disabled={answers[current] === undefined}>
          {current < questions.length - 1 ? 'Next' : 'Submit'}
        </button>
      </div>
    {/if}
  {:else if stage === 'grading'}
    <p class="status">Grading…</p>
  {:else if stage === 'score'}
    <div class="score-screen">
      <h3>You scored {score}%</h3>
      <div class="results">
        {#each results as r, i}
          <div class="result" class:correct={r.correct}>
            <p><strong>Q{i + 1}:</strong> {r.correct ? 'Correct' : 'Incorrect'}</p>
            <p class="explanation">{r.explanation}</p>
          </div>
        {/each}
      </div>
      <button type="button" class="btn-primary" onclick={onDone}>Back to prerequisites</button>
    </div>
  {:else if stage === 'error'}
    <p class="error">{errorMessage}</p>
    <div class="row-actions">
      <button type="button" class="btn-secondary" onclick={onCancel}>Back to prereqs</button>
      <button type="button" class="btn-primary" onclick={start}>Try again</button>
    </div>
  {/if}
</div>

<style>
  .verify-quiz { display: flex; flex-direction: column; gap: 1rem; max-width: 560px; }
  .status { color: var(--muted); font-size: 0.9rem; }
  .progress { color: var(--muted); font-size: 0.85rem; margin: 0; }
  h3 { margin: 0; }
  .options { display: flex; flex-direction: column; gap: 0.5rem; }
  .option { text-align: left; background: var(--hover); color: var(--text); border: none; padding: 0.65rem 0.9rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; }
  .option.selected { background: var(--accent); color: var(--surface); }
  .row-actions { display: flex; gap: 0.6rem; }
  button { padding: 0.6rem 1rem; border-radius: 8px; border: none; cursor: pointer; font-size: 0.9rem; font-weight: 550; }
  .btn-primary { background: var(--accent); color: var(--surface); }
  .btn-primary:disabled { opacity: 0.6; cursor: default; }
  .btn-secondary { background: var(--hover); color: var(--text); }
  .score-screen { display: flex; flex-direction: column; gap: 1rem; }
  .results { display: flex; flex-direction: column; gap: 0.6rem; }
  .result { border-left: 3px solid var(--danger); padding-left: 0.75rem; }
  .result.correct { border-color: var(--good); }
  .explanation { color: var(--text); font-size: 0.88rem; margin: 0.2rem 0 0 0; }
  .error { color: var(--danger); font-size: 0.9rem; }
</style>
