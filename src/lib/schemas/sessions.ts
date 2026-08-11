import { z } from 'zod';
import { idSchema, isoDatetimeSchema } from './common';

export const createStudySessionSchema = z.strictObject({
  course_id: idSchema.optional(),
  intended_event_type: z.string().min(1),
  planned_minutes: z.number().int().min(1).optional(),
  kc_ids: z.array(idSchema).optional(),
});
export type CreateStudySessionInput = z.infer<typeof createStudySessionSchema>;

// Completing a session appends one dual-role `tutor_session`-shaped event
// (matching intended_event_type) per touched KC via the events service.
export const completeStudySessionSchema = z.strictObject({
  ended_at: isoDatetimeSchema.optional(),
  reflection: z.string().optional(),
  kc_ids_touched: z.array(idSchema).optional(),
});
export type CompleteStudySessionInput = z.infer<typeof completeStudySessionSchema>;

export const listSessionsQuerySchema = z.strictObject({
  course: idSchema.optional(),
});
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
