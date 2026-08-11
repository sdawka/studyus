import { z } from 'zod';

export const listCoursesQuerySchema = z.strictObject({
  include: z.literal('mastery').optional(),
});
export type ListCoursesQuery = z.infer<typeof listCoursesQuerySchema>;
