// Exercise attempt grading — the flow POST /api/v1/exercises/:id/attempt
// calls (docs/api.md's v2.0 section documents the shapes this backs). Grades
// a submitted numeric or mcq answer against the seeded exercise bank
// (src/lib/services/exercises.ts) and appends one `retrieval_practice` event,
// same dual-role idiom as quick_quiz's submitQuickQuizAnswers.
import type { Db } from '../../db/client';
import type { ExerciseAttemptInput } from '../schemas/exercises';
import { createEvent } from '../services/events';
import { getExerciseWithAnswers, type ExerciseRow } from '../services/exercises';
import { ExerciseAttemptMismatchError } from '../services/util';

type McqDetails = { options: string[]; correct_index: number; explanation: string };
type NumericDetails = { answer: { value: number; unit: string | null; tolerance_pct: number }; solution: string };

function gradeNumeric(row: ExerciseRow, input: Extract<ExerciseAttemptInput, { value: number }>) {
  const details = row.details as NumericDetails;
  const { value: target, unit, tolerance_pct } = details.answer;
  const allowedDelta = (tolerance_pct / 100) * Math.abs(target);
  const correct = Math.abs(input.value - target) <= allowedDelta;
  return {
    correct,
    answer: { value: target, unit },
    solution: details.solution,
  };
}

function gradeMcq(row: ExerciseRow, input: Extract<ExerciseAttemptInput, { selected_index: number }>) {
  const details = row.details as McqDetails;
  const correct = input.selected_index === details.correct_index;
  return {
    correct,
    correct_index: details.correct_index,
    explanation: details.explanation,
  };
}

/**
 * Grades a submitted attempt against exercise `exerciseId` (ownership
 * checked via its KC's course), records a `retrieval_practice` event on the
 * exercise's KC, and returns the graded result. Numeric attempts pass
 * `{value}`, mcq attempts pass `{selected_index}` — a mismatch against the
 * exercise's actual `kind` (including `worked`, which has no gradeable
 * attempt) throws `ExerciseAttemptMismatchError`.
 */
function grade(exercise: ExerciseRow, input: ExerciseAttemptInput) {
  if (exercise.kind === 'numeric') {
    if (!('value' in input)) throw new ExerciseAttemptMismatchError('This exercise expects a numeric {value} attempt');
    return gradeNumeric(exercise, input);
  }
  if (exercise.kind === 'mcq') {
    if (!('selected_index' in input)) throw new ExerciseAttemptMismatchError('This exercise expects a {selected_index} attempt');
    return gradeMcq(exercise, input);
  }
  throw new ExerciseAttemptMismatchError('Worked exercises have no gradeable attempt — show the solution instead');
}

export async function gradeExerciseAttempt(db: Db, userId: string, exerciseId: string, input: ExerciseAttemptInput) {
  const exercise = await getExerciseWithAnswers(db, userId, exerciseId);
  const result = grade(exercise, input);

  // Source 'tutor', same as quick_quiz's grading events: this is a
  // flow-computed, non-manual correctness check, not a user-authored
  // POST /events row (which defaults to 'manual').
  const { masteryDeltas } = await createEvent(
    db,
    userId,
    {
      type: 'retrieval_practice',
      kc_id: exercise.kcId,
      payload: { correct: result.correct, exercise_id: exercise.id, channel: 'exercise' },
    },
    'tutor',
  );

  return { ...result, mastery_deltas: masteryDeltas };
}
