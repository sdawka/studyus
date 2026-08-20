import { z } from 'zod';
import { EXERCISE_KINDS } from '../content/exercises';

// GET /kcs/:id/exercises — v2.0.
export const listKcExercisesQuerySchema = z.strictObject({
  kind: z.enum(EXERCISE_KINDS).optional(),
});
export type ListKcExercisesQuery = z.infer<typeof listKcExercisesQuerySchema>;

// POST /exercises/:id/attempt — v2.0. Body shape isn't tagged with `kind`
// (the client only knows what it rendered); the flow infers which branch
// applies from the exercise row itself and mismatches (e.g. selected_index
// against a numeric exercise) are a flow-level error, not a schema one.
export const exerciseAttemptSchema = z.union([
  z.strictObject({ value: z.number() }),
  z.strictObject({ selected_index: z.number().int().min(0) }),
]);
export type ExerciseAttemptInput = z.infer<typeof exerciseAttemptSchema>;
