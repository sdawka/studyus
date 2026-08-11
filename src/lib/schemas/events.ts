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
  // Dual-role events (both IE and AE) — payload may carry correctness/self-rating
  'practice_done',
  'retrieval_practice',
  'tutor_session',
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
  practice_done: { isInstructional: true, isAssessment: true },
  retrieval_practice: { isInstructional: true, isAssessment: true },
  tutor_session: { isInstructional: true, isAssessment: true },
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
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
