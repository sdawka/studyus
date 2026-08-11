import { z } from 'zod';

export const updateUserSchema = z.strictObject({
  name: z.string().min(1).optional(),
  current_term: z.string().nullable().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
