import { z } from 'zod';
import { idSchema, isoDatetimeSchema } from './common';

export const createStudySessionSchema = z.strictObject({
  course_id: idSchema.optional(),
  intended_event_type: z.string().min(1),
  planned_minutes: z.number().int().min(1).optional(),
  kc_ids: z.array(idSchema).optional(),
  // When set, this is a planned/scheduled session — startedAt is stamped
  // with this same value (see createSession) rather than "now".
  scheduled_at: isoDatetimeSchema.optional(),
});
export type CreateStudySessionInput = z.infer<typeof createStudySessionSchema>;

// Completing a session appends one dual-role `tutor_session`-shaped event
// (matching intended_event_type) per touched KC via the events service.
export const completeStudySessionSchema = z.strictObject({
  ended_at: isoDatetimeSchema.optional(),
  reflection: z.string().optional(),
  kc_ids_touched: z.array(idSchema).optional(),
  // Reschedule a still-planned session in the same call, if needed.
  scheduled_at: isoDatetimeSchema.optional(),
});
export type CompleteStudySessionInput = z.infer<typeof completeStudySessionSchema>;

export const listSessionsQuerySchema = z.strictObject({
  course: idSchema.optional(),
  // Range over COALESCE(scheduled_at, started_at), matching the calendar
  // query convention.
  from: isoDatetimeSchema.optional(),
  to: isoDatetimeSchema.optional(),
});
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
