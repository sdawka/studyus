import { z } from 'zod';
import { idSchema } from './common';

export const createQuickQuizSchema = z.strictObject({
  course_id: idSchema.optional(),
  kc_id: idSchema.optional(),
  count: z.number().int().min(1).max(10).optional(),
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
