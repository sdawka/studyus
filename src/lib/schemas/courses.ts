import { z } from 'zod';

export const listCoursesQuerySchema = z.strictObject({
  include: z.literal('mastery').optional(),
});
export type ListCoursesQuery = z.infer<typeof listCoursesQuerySchema>;

// v1.1 addition: add-course modal + API. `color_hue` is an OKLCH hue
// (0-360) — see docs/api.md "Courses — create/update" for the storage
// convention (persisted in the existing `courses.color` text column).
export const createCourseSchema = z.strictObject({
  code: z.string().min(1).max(20),
  title: z.string().min(1).max(200),
  term: z.string().max(50).optional(),
  credits: z.number().int().optional(),
  instructor: z.string().max(200).optional(),
  overview: z.string().max(5000).optional(),
  color_hue: z.number().int().min(0).max(360).optional(),
});
export type CreateCourseInput = z.infer<typeof createCourseSchema>;

// Partial; never includes `code`/`slug` — the slug is immutable post-create.
// v1.3: `meeting_days` (ISO weekday numbers, Mon=1..Sun=7) drives the class
// sessions generation sweep; the service dedupes/sorts before storing.
export const updateCourseSchema = z.strictObject({
  title: z.string().min(1).max(200).optional(),
  term: z.string().max(50).nullable().optional(),
  credits: z.number().int().nullable().optional(),
  instructor: z.string().max(200).nullable().optional(),
  overview: z.string().max(5000).nullable().optional(),
  archived: z.boolean().optional(),
  color_hue: z.number().int().min(0).max(360).optional(),
  meeting_days: z.array(z.number().int().min(1).max(7)).nullable().optional(),
});
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
