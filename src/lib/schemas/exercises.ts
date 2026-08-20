import { z } from 'zod';
import { EXERCISE_KINDS } from '../content/exercises';

// GET /kcs/:id/exercises — v2.0.
export const listKcExercisesQuerySchema = z.strictObject({
  kind: z.enum(EXERCISE_KINDS).optional(),
});
export type ListKcExercisesQuery = z.infer<typeof listKcExercisesQuerySchema>;
