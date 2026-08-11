import { z } from 'zod';
import { idSchema } from './common';

export const createQuickQuizSchema = z.strictObject({
  course_id: idSchema.optional(),
  kc_id: idSchema.optional(),
  count: z.number().int().min(1).max(10).optional(),
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
