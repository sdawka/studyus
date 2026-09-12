import { z } from 'zod';

export const experienceResponseSchema = z.strictObject({
  response: z.string().trim().min(1).max(20_000).optional(),
  selected_index: z.number().int().nonnegative().optional(),
}).refine((value) => value.response !== undefined || value.selected_index !== undefined, 'A response is required');
export type ExperienceResponseInput = z.infer<typeof experienceResponseSchema>;
