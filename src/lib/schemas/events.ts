// Event schemas + the single source of truth for the KLI dual role-flag
// mapping (is_instructional / is_assessment) per event type. Both the events
// service and any route/flow that needs to know an event's role must import
// EVENT_ROLE_FLAGS from here rather than re-deriving it.
import { z } from 'zod';
import { idSchema, isoDatetimeSchema } from './common';

export const EVENT_TYPES = [
  // Pure instructional events (IE)
  'lecture_attended',
  'lecture_missed',
  'video_watched',
  'reading_done',
  'taught_someone',
  // Pure assessment events (AE) — payload carries a score/correctness signal
  'quiz_taken',
  'assignment_graded',
  'exam_graded',
  'self_assessment',
  // Assessment evidence used to initialize or diagnose a learner model.
  'placement_probe',
  'diagnostic_probe',
  // Dual-role events (both IE and AE) — payload may carry correctness/self-rating
  'practice_done',
  'retrieval_practice',
  'tutor_session',
  // Context-only triage events. These are activity-stream facts, not learning
  // evidence, and therefore must never affect mastery or KC freshness.
  'task_completed',
  'task_dismissed',
  'correction_accepted',
  'correction_dismissed',
  'recommendation_followed',
  'recommendation_ignored',
  // Context-only administrative events.
  'course_added',
  'course_archived',
  'plan_committed',
  'session_scheduled',
  'session_rescheduled',
  'settings_changed',
  // Context-only coach events.
  'coach_session',
  'reflection_captured',
  'digest_sent',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type EventRoleFlags = { isInstructional: boolean; isAssessment: boolean };

export const EVENT_ROLE_FLAGS: Record<EventType, EventRoleFlags> = {
  lecture_attended: { isInstructional: true, isAssessment: false },
  lecture_missed: { isInstructional: true, isAssessment: false },
  video_watched: { isInstructional: true, isAssessment: false },
  reading_done: { isInstructional: true, isAssessment: false },
  taught_someone: { isInstructional: true, isAssessment: false },
  quiz_taken: { isInstructional: false, isAssessment: true },
  assignment_graded: { isInstructional: false, isAssessment: true },
  exam_graded: { isInstructional: false, isAssessment: true },
  self_assessment: { isInstructional: false, isAssessment: true },
  placement_probe: { isInstructional: false, isAssessment: true },
  diagnostic_probe: { isInstructional: false, isAssessment: true },
  practice_done: { isInstructional: true, isAssessment: true },
  retrieval_practice: { isInstructional: true, isAssessment: true },
  tutor_session: { isInstructional: true, isAssessment: true },
  task_completed: { isInstructional: false, isAssessment: false },
  task_dismissed: { isInstructional: false, isAssessment: false },
  correction_accepted: { isInstructional: false, isAssessment: false },
  correction_dismissed: { isInstructional: false, isAssessment: false },
  recommendation_followed: { isInstructional: false, isAssessment: false },
  recommendation_ignored: { isInstructional: false, isAssessment: false },
  course_added: { isInstructional: false, isAssessment: false },
  course_archived: { isInstructional: false, isAssessment: false },
  plan_committed: { isInstructional: false, isAssessment: false },
  session_scheduled: { isInstructional: false, isAssessment: false },
  session_rescheduled: { isInstructional: false, isAssessment: false },
  settings_changed: { isInstructional: false, isAssessment: false },
  coach_session: { isInstructional: false, isAssessment: false },
  reflection_captured: { isInstructional: false, isAssessment: false },
  digest_sent: { isInstructional: false, isAssessment: false },
};

export const EVENT_SOURCES = ['manual', 'session', 'tutor', 'seed'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

// Free-form event payload (score, correctness, self_rating, channel, etc.) —
// intentionally loose since it varies by event type; mastery.ts documents
// which keys it reads.
export const eventPayloadSchema = z.record(z.string(), z.unknown());

export const createEventSchema = z.strictObject({
  type: z.enum(EVENT_TYPES),
  kc_id: idSchema.optional(),
  course_id: idSchema.optional(),
  ts: isoDatetimeSchema.optional(),
  payload: eventPayloadSchema.optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

// Manual-source events only; type/payload/ts may be corrected. Role flags are
// always re-derived from `type` when it changes.
export const updateEventSchema = z.strictObject({
  type: z.enum(EVENT_TYPES).optional(),
  payload: eventPayloadSchema.optional(),
  ts: isoDatetimeSchema.optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const listEventsQuerySchema = z.strictObject({
  course: idSchema.optional(),
  kc: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  // ISO datetimes, matching the calendar query convention — parsed to epoch
  // ms (via toEpochMs) at the service boundary.
  from: isoDatetimeSchema.optional(),
  to: isoDatetimeSchema.optional(),
  // Comma-separated list of event types to filter to (e.g. attendance-only
  // views). Additive filter — omitting it preserves prior unfiltered behavior.
  types: z
    .string()
    .transform((s) => s.split(',').map((t) => t.trim()).filter(Boolean))
    .pipe(z.array(z.enum(EVENT_TYPES)).min(1))
    .optional(),
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

// GET /kcs/:id/events — previously raw `Number(searchParams.get(...))`,
// which let a non-numeric or out-of-range value flow straight into
// db.select().limit()/.offset() and 500 instead of 400. Same bounds as
// listEventsQuerySchema.limit above.
export const kcEventsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type KcEventsQuery = z.infer<typeof kcEventsQuerySchema>;
