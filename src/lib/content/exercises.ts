// Pure content-pipeline module for courses/<slug>/exercises.json (frozen
// contract: courses/exercise-schema.md, schema_version 1). Sibling file to
// content.json (same pattern as courses/capabilities.json). No
// cloudflare/server-only imports — this must be importable from both
// scripts/seed.ts (plain Node/tsx) and vitest (workerd pool).
import { z } from 'zod';

export const EXERCISE_KINDS = ['mcq', 'numeric', 'worked'] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

// kebab-case, lowercase alnum segments joined by single hyphens — same
// convention as src/lib/content/courseContent.ts's slugRegex.
const slugRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const exerciseBaseShape = {
  // kc slug in THIS course's content.json — no `#`, no cross-course refs
  // (per exercise-schema.md).
  kc: z.string().regex(slugRegex),
  slug: z.string().regex(slugRegex),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  prompt: z.string().min(1),
  source: z.string().min(1),
};

export const exerciseAnswerSchema = z.strictObject({
  value: z.number(),
  unit: z.string().nullable(),
  // 0 is legitimate: exact-count answers (e.g. base pairs, integer orders)
  // grade as exact matches rather than within a percentage band.
  tolerance_pct: z.number().nonnegative().optional().default(2),
});
export type ExerciseAnswer = z.infer<typeof exerciseAnswerSchema>;

const mcqExerciseSchema = z.strictObject({
  ...exerciseBaseShape,
  kind: z.literal('mcq'),
  options: z.array(z.string().min(1)).min(3).max(5),
  correct_index: z.number().int().min(0),
  explanation: z.string().min(1),
});

const numericExerciseSchema = z.strictObject({
  ...exerciseBaseShape,
  kind: z.literal('numeric'),
  answer: exerciseAnswerSchema,
  solution: z.string().min(1),
});

const workedExerciseSchema = z.strictObject({
  ...exerciseBaseShape,
  kind: z.literal('worked'),
  solution: z.string().min(1),
});

// Discriminated union on `kind` gives kind-conditional required fields for
// free (mcq: options/correct_index/explanation; numeric: answer/solution;
// worked: solution) — an object of the wrong kind fails on the extra/missing
// keys via each branch's strictObject.
export const exerciseSchema = z
  .discriminatedUnion('kind', [mcqExerciseSchema, numericExerciseSchema, workedExerciseSchema])
  .superRefine((exercise, ctx) => {
    if (exercise.kind === 'mcq' && exercise.correct_index >= exercise.options.length) {
      ctx.addIssue({
        code: 'custom',
        message: `correct_index (${exercise.correct_index}) must be < options.length (${exercise.options.length})`,
        path: ['correct_index'],
      });
    }
  });
export type Exercise = z.infer<typeof exerciseSchema>;
export type McqExercise = z.infer<typeof mcqExerciseSchema>;
export type NumericExercise = z.infer<typeof numericExerciseSchema>;
export type WorkedExercise = z.infer<typeof workedExerciseSchema>;

export const exerciseFileSchema = z
  .strictObject({
    schema_version: z.literal(1),
    exercises: z.array(exerciseSchema),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.exercises.forEach((exercise, index) => {
      const key = `${exercise.kc}:${exercise.slug}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate (kc, slug) "${key}" — slug must be unique per kc within the file`,
          path: ['exercises', index],
        });
      }
      seen.add(key);
    });
  });
export type ExerciseFile = z.infer<typeof exerciseFileSchema>;

/** Maps an authored Exercise to the kind-specific fields stored in exercises.details. */
export function exerciseDetails(exercise: Exercise): Record<string, unknown> {
  if (exercise.kind === 'mcq') return { options: exercise.options, correct_index: exercise.correct_index, explanation: exercise.explanation };
  if (exercise.kind === 'numeric') return { answer: exercise.answer, solution: exercise.solution };
  return { solution: exercise.solution };
}
