import { z } from 'zod';
import { idSchema } from './common';

export const createQuickQuizSchema = z.strictObject({
  course_id: idSchema.optional(),
  kc_id: idSchema.optional(),
  count: z.number().int().min(1).max(10).optional(),
  // A recommendation-launched quiz is an explicitly time-boxed study
  // action. The generic quiz door may continue to omit this.
  planned_minutes: z.union([z.literal(15), z.literal(25), z.literal(50)]).optional(),
  // v1.7: explicit KC targeting (e.g. prereq verification before an absorb
  // flow) — ownership-checked same as kc_id, overrides the mastery
  // heuristic when present.
  kc_ids: z.array(idSchema).optional(),
});
export type CreateQuickQuizInput = z.infer<typeof createQuickQuizSchema>;

export const submitQuickQuizAnswersSchema = z.strictObject({
  answers: z
    .array(
      z.object({
        question_index: z.number().int().min(0),
        selected_index: z.number().int().min(0),
      }),
    )
    .min(1),
});
export type SubmitQuickQuizAnswersInput = z.infer<typeof submitQuickQuizAnswersSchema>;
