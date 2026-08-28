import { z } from 'zod';
import { idSchema, isoDatetimeSchema } from './common';
import { EVENT_TYPES } from './events';

export const createStudySessionSchema = z.strictObject({
  course_id: idSchema.optional(),
  // Constrained to the real event-type vocabulary — services/sessions.ts's
  // resolveEventType previously fell back to 'practice_done' silently for
  // any string that didn't match, so a typo or garbage value never
  // surfaced as an error; every real caller only ever sends a value that's
  // already a member of EVENT_TYPES (see StudyFlow.svelte / CreateSessionPopover.svelte).
  intended_event_type: z.enum(EVENT_TYPES),
  planned_minutes: z.number().int().min(1).optional(),
  kc_ids: z.array(idSchema).optional(),
  // When set, this is a planned/scheduled session — startedAt is stamped
  // with this same value (see createSession) rather than "now".
  scheduled_at: isoDatetimeSchema.optional(),
  // v1.9: session-shape ritual picked at session start (see rituals table,
  // kind 'session_shape'|'both') — StudyFlow.svelte renders `steps` as a
  // guidance step rail. Optional; independent of course_id.
  ritual_id: idSchema.optional(),
});
export type CreateStudySessionInput = z.infer<typeof createStudySessionSchema>;

const sessionKcOutcomeSchema = z.strictObject({
  kc_id: idSchema,
  self_rating: z.number().int().min(1).max(5).optional(),
});

// `kc_outcomes` is the canonical completion shape. The legacy id-only list
// remains accepted, but an explicit empty array now means exactly zero KCs;
// only omission of both fields falls back to links stored at session start.
export const completeStudySessionSchema = z
  .strictObject({
    ended_at: isoDatetimeSchema.optional(),
    reflection: z.string().optional(),
    kc_outcomes: z.array(sessionKcOutcomeSchema).optional(),
    kc_ids_touched: z.array(idSchema).optional(),
    // Reschedule a still-planned session in the same call, if needed.
    scheduled_at: isoDatetimeSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.kc_outcomes !== undefined && input.kc_ids_touched !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'Use either kc_outcomes or kc_ids_touched, not both' });
    }
    if (input.kc_outcomes) {
      const ids = input.kc_outcomes.map((outcome) => outcome.kc_id);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: 'custom', path: ['kc_outcomes'], message: 'Each KC may appear only once' });
      }
    }
  });
export type CompleteStudySessionInput = z.infer<typeof completeStudySessionSchema>;

export const discardStudySessionSchema = z.strictObject({
  ended_at: isoDatetimeSchema.optional(),
});
export type DiscardStudySessionInput = z.infer<typeof discardStudySessionSchema>;

// v1.6: reschedule a still-planned session (PATCH /sessions/:id, distinct
// from PATCH /sessions/:id/complete above). services/sessions.ts::updateSession
// rejects with ConflictError once the session has an ended_at — a completed
// session's time/duration is history, not a plan to move around.
export const updateSessionSchema = z.strictObject({
  scheduled_at: isoDatetimeSchema.optional(),
  planned_minutes: z.number().int().min(1).optional(),
});
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

export const listSessionsQuerySchema = z.strictObject({
  course: idSchema.optional(),
  // Range over COALESCE(scheduled_at, started_at), matching the calendar
  // query convention.
  from: isoDatetimeSchema.optional(),
  to: isoDatetimeSchema.optional(),
});
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
