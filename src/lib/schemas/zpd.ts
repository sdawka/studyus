import { z } from 'zod';
import { idSchema } from './common';

// Mirrors services/mastery.ts::KC_STATUSES — see capabilities.ts for the same
// note on why this isn't imported directly from the service layer.
const kcStatusSchema = z.enum(['not-started', 'learning', 'review', 'mastered']);

// One frontier KC: unmastered, every prerequisite ready (see src/lib/zpd.ts's
// pure selectFrontier — readiness = status !== 'not-started' && mastery >=
// MASTERY_CONSTANTS.REVIEW_THRESHOLD, single definition shared with
// knowledgeMap.ts's isReady).
export const frontierKcSchema = z.object({
  kc_id: idSchema,
  name: z.string(),
  slug: z.string().nullable(),
  mastery: z.number().int().min(0).max(100),
  status: kcStatusSchema,
});
export type FrontierKc = z.infer<typeof frontierKcSchema>;

export const frontierByCourseSchema = z.object({
  course_id: idSchema,
  course_title: z.string(),
  course_slug: z.string(),
  color: z.string().nullable(),
  frontier: z.array(frontierKcSchema),
});
export type FrontierByCourse = z.infer<typeof frontierByCourseSchema>;

// GET /profile/frontier response — computed on read from kcs + kc_edges
// (src/lib/services/zpd.ts::getGlobalFrontier), zero persistence.
export const frontierResponseSchema = z.object({
  by_course: z.array(frontierByCourseSchema),
  counts: z.object({
    frontier: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    mastered: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});
export type FrontierResponse = z.infer<typeof frontierResponseSchema>;
