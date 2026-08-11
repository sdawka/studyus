<script lang="ts">
  type Course = { id: string; title: string };
  type Question = { index: number; kc_id: string; question: string; options: string[] };
  type Result = { question_index: number; kc_id: string; correct: boolean; correct_index: number; explanation: string };
  type MasteryDelta = { kc_id: string; old_mastery: number; new_mastery: number };

  let { courses = [], preselectedCourse = '' }: { courses?: Course[]; preselectedCourse?: string } = $props();

  let stage = $state<'setup' | 'loading' | 'quiz' | 'grading' | 'score' | 'error'>('setup');
  let courseId = $state(preselectedCourse);
  let count = $state(5);
  let quizId = $state<string | null>(null);
  let questions = $state<Question[]>([]);
  let current = $state(0);
  let answers = $state<Record<number, number>>({});
  let results = $state<Result[]>([]);
  let score = $state(0);
  let masteryDeltas = $state<MasteryDelta[]>([]);
  let errorMessage = $state<string | null>(null);

  async function startQuiz() {
    stage = 'loading';
    errorMessage = null;
    try {
      const res = await fetch('/api/v1/flows/quick_quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: courseId || undefined, count }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not start the quiz right now.');
      quizId = json.data.id;
      questions = json.data.questions;
      current = 0;
      answers = {};
      stage = 'quiz';
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Something went wrong.';
      stage = 'error';
    }
  }

  function selectOption(index: number) {
    answers = { ...answers, [current]: index };
  }

  function next() {
    if (current < questions.length - 1) current += 1;
    else submitQuiz();
  }

  async function submitQuiz() {
    stage = 'grading';
    try {
      const res = await fetch(`/api/v1/flows/quick_quiz/${quizId}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: Object.entries(answers).map(([index, selected]) => ({ question_index: Number(index), selected_index: selected })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not grade the quiz.');
      score = json.data.score;
      results = json.data.results;
      masteryDeltas = json.data.mastery_deltas;
      stage = 'score';
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Something went wrong.';
      stage = 'error';
    }
  }

  function restart() {
    stage = 'setup';
    quizId = null;
    questions = [];
  }
</script>

<div class="quick-quiz">
  {#if stage === 'setup' || stage === 'loading'}
    <div class="setup">
      <label>
        Course
        <select bind:value={courseId}>
          <option value="">All courses</option>
          {#each courses as c (c.id)}
            <option value={c.id}>{c.title}</option>
          {/each}
        </select>
      </label>
      <label>
        Questions
        <select bind:value={count}>
          {#each [3, 5, 8, 10] as n}
            <option value={n}>{n}</option>
          {/each}
        </select>
      </label>
      <button onclick={startQuiz} disabled={stage === 'loading'}>{stage === 'loading' ? 'Preparing…' : 'Start quiz'}</button>
    </div>
  {:else if stage === 'quiz'}
    {#if questions[current]}
      <div class="question">
        <p class="progress">Question {current + 1} of {questions.length}</p>
        <h3>{questions[current].question}</h3>
        <div class="options">
          {#each questions[current].options as opt, i}
            <button type="button" class="option {answers[current] === i ? 'selected' : ''}" onclick={() => selectOption(i)}>
              {opt}
            </button>
          {/each}
        </div>
        <button class="next-btn" onclick={next} disabled={answers[current] === undefined}>
          {current < questions.length - 1 ? 'Next' : 'Submit'}
        </button>
      </div>
    {/if}
  {:else if stage === 'grading'}
    <p>Grading…</p>
  {:else if stage === 'score'}
    <div class="score-screen">
      <h2>You scored {score}%</h2>
      <p class="muted">This is just for you to see where to focus next — no pressure.</p>
      <div class="results">
        {#each results as r, i}
          <div class="result {r.correct ? 'correct' : 'incorrect'}">
            <p><strong>Q{i + 1}:</strong> {r.correct ? 'Correct' : 'Incorrect'}</p>
            <p class="explanation">{r.explanation}</p>
          </div>
        {/each}
      </div>
      {#if masteryDeltas.length}
        <div class="deltas">
          <h4>Mastery movement</h4>
          {#each masteryDeltas as d}
            <p>{d.old_mastery}% → {d.new_mastery}%</p>
          {/each}
        </div>
      {/if}
      <button onclick={restart}>Take another quiz</button>
    </div>
  {:else if stage === 'error'}
    <p class="error">{errorMessage}</p>
    <button onclick={restart}>Try again</button>
  {/if}
</div>

<style>
  .quick-quiz { max-width: 560px; display: flex; flex-direction: column; gap: 1rem; }
  .setup { display: flex; flex-direction: column; gap: 1rem; max-width: 320px; }
  .setup label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.9rem; }
  select { padding: 0.5rem; border-radius: 8px; border: 1px solid var(--border, #e5e7eb); }
  button { padding: 0.6rem 1rem; border-radius: 8px; border: none; cursor: pointer; background: var(--accent, #3f6fd8); color: white; font-size: 0.95rem; }
  button:disabled { opacity: 0.6; cursor: default; }
  .question { display: flex; flex-direction: column; gap: 1rem; }
  .progress { color: #6b7280; font-size: 0.85rem; margin: 0; }
  .options { display: flex; flex-direction: column; gap: 0.5rem; }
  .option { background: #f0f2f5; color: #1c1e21; text-align: left; }
  .option.selected { background: var(--accent, #3f6fd8); color: white; }
  .next-btn { align-self: flex-start; }
  .score-screen { display: flex; flex-direction: column; gap: 1rem; }
  .result { border-left: 3px solid #e5e7eb; padding-left: 0.75rem; }
  .result.correct { border-color: #059669; }
  .result.incorrect { border-color: #b91c1c; }
  .explanation { color: #374151; font-size: 0.9rem; margin: 0.2rem 0 0 0; }
  .deltas h4 { margin: 0 0 0.4rem 0; font-size: 0.9rem; }
  .error { color: #b91c1c; }
  .muted { color: #6b7280; font-size: 0.9rem; }
</style>
