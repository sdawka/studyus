<script lang="ts">
  import { onMount } from 'svelte';
  import { captureBehavioralEvent } from '../../lib/analytics/client';
  import { createQuizAnalytics, installPageExitAbandonment } from '../../lib/analytics/learning';
  import type { AvailableMinutes } from '../../lib/schemas/nextMove';
  type Course = { id: string; title: string };
  type Question = { index: number; kc_id: string; question: string; options: string[] };
  type Result = { question_index: number; kc_id: string; correct: boolean; correct_index: number; explanation: string };
  type MasteryDelta = { kc_id: string; old_mastery: number; new_mastery: number };

  let {
    courses = [],
    preselectedCourse = '',
    preselectedKc = '',
    preselectedMinutes = 25,
    autoStart = false,
    aiGenerationEnabled,
    aiUnavailableReason,
  }: {
    courses?: Course[];
    preselectedCourse?: string;
    preselectedKc?: string;
    preselectedMinutes?: AvailableMinutes;
    autoStart?: boolean;
    aiGenerationEnabled: boolean;
    aiUnavailableReason: 'disabled' | 'provider_not_configured' | null;
  } = $props();

  let stage = $state<'setup' | 'loading' | 'quiz' | 'grading' | 'score' | 'error'>('setup');
  let courseId = $state(preselectedCourse);
  let count = $state(preselectedMinutes === 15 ? 3 : preselectedMinutes === 50 ? 8 : 5);
  let quizId = $state<string | null>(null);
  let questions = $state<Question[]>([]);
  let current = $state(0);
  let answers = $state<Record<number, number>>({});
  let results = $state<Result[]>([]);
  let score = $state(0);
  let masteryDeltas = $state<MasteryDelta[]>([]);
  let errorMessage = $state<string | null>(null);
  const quizAnalytics = createQuizAnalytics(captureBehavioralEvent);

  function answeredCount(): number {
    return Object.keys(answers).length;
  }

  async function startQuiz() {
    quizAnalytics.abandon(answeredCount());
    stage = 'loading';
    errorMessage = null;
    try {
      const res = await fetch('/api/v1/flows/quick_quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id: courseId || undefined,
          kc_id: preselectedKc || undefined,
          count,
          planned_minutes: preselectedKc ? preselectedMinutes : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'Could not start the quiz right now.');
      quizId = json.data.id;
      questions = json.data.questions;
      current = 0;
      answers = {};
      stage = 'quiz';
      quizAnalytics.start(questions.map((question) => question.kc_id), questions.length);
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
      quizAnalytics.terminal();
      stage = 'score';
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Something went wrong.';
      stage = 'error';
    }
  }

  function restart() {
    quizAnalytics.abandon(answeredCount());
    stage = 'setup';
    quizId = null;
    questions = [];
  }

  onMount(() => {
    if (autoStart) void startQuiz();
    return installPageExitAbandonment(() => quizAnalytics.abandon(answeredCount()));
  });
</script>

<div class="quick-quiz">
  {#if stage === 'setup' || stage === 'loading'}
    <div class="setup">
      {#if preselectedKc}
        <p class="target-note">Targeted review · {preselectedMinutes} minutes · {count} questions</p>
      {/if}
      {#if !aiGenerationEnabled}
        <p class="ai-note" role="status" data-ai-feature="quiz-generation">
          <strong>Seeded quiz mode.</strong> Questions already in the course remain available.
          {aiUnavailableReason === 'provider_not_configured'
            ? ' OpenRouter is not configured, so missing questions cannot be generated.'
            : ' AI question generation is disabled in this environment.'}
        </p>
      {/if}
      {#if !preselectedKc}
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
      {/if}
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
  select { padding: 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border); }
  button { padding: 0.6rem 1rem; border-radius: var(--radius-sm); border: none; cursor: pointer; background: var(--accent); color: var(--surface); font-size: 0.95rem; }
  button:disabled { opacity: 0.6; cursor: default; }
  .question { display: flex; flex-direction: column; gap: 1rem; }
  .progress { color: var(--muted); font-size: 0.85rem; margin: 0; }
  .options { display: flex; flex-direction: column; gap: 0.5rem; }
  .option { background: var(--hover); color: var(--text); text-align: left; }
  .option.selected { background: var(--accent); color: var(--surface); }
  .next-btn { align-self: flex-start; }
  .score-screen { display: flex; flex-direction: column; gap: 1rem; }
  .result { border-left: 3px solid var(--border); padding-left: 0.75rem; }
  .result.correct { border-color: var(--good); }
  .result.incorrect { border-color: var(--danger); }
  .explanation { color: var(--text); font-size: 0.9rem; margin: 0.2rem 0 0 0; }
  .deltas h4 { margin: 0 0 0.4rem 0; font-size: 0.9rem; }
  .error { color: var(--danger); }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .target-note { margin: 0; color: var(--muted); font-size: 0.9rem; }
  .ai-note { margin: 0; padding: 0.7rem; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--muted); font-size: 0.85rem; line-height: 1.4; }
  .ai-note strong { color: var(--text); }
</style>
