import { z } from 'zod';

export const updateUserSchema = z.strictObject({
  name: z.string().min(1).optional(),
  current_term: z.string().nullable().optional(),
  // Additive (post-freeze): marks the onboarding stepper complete. One-way —
  // there's no unset; the onboarding page is skippable but not re-enterable.
  onboarded: z.literal(true).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
