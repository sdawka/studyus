// Class sessions (v1.3): attendance re-modeled as pre-existing scheduled
// rows whose status gets updated, not events appended by button clicks.
import { z } from 'zod';
import { isoDatetimeSchema } from './common';

export const CLASS_SESSION_STATUSES = ['attended', 'missed'] as const;
export type ClassSessionStatus = (typeof CLASS_SESSION_STATUSES)[number];

export const listClassSessionsQuerySchema = z.strictObject({
  from: isoDatetimeSchema.optional(),
  to: isoDatetimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type ListClassSessionsQuery = z.infer<typeof listClassSessionsQuerySchema>;

// Minutes-from-midnight bounds for a class's meeting time (v1.6).
const MINUTE_MIN = 0;
const MINUTE_MAX = 1439;

// Manual sessions only carry a date — status starts unmarked (null) and is
// set afterwards via PATCH /class-sessions/:id. `start_min`/`end_min` are
// optional and both-or-neither: a manual session with no meeting time stays
// all-day (both null), matching sweep-generated rows.
export const createClassSessionSchema = z
  .strictObject({
    date: isoDatetimeSchema,
    start_min: z.number().int().min(MINUTE_MIN).max(MINUTE_MAX).optional(),
    end_min: z.number().int().min(MINUTE_MIN).max(MINUTE_MAX).optional(),
  })
  .refine((v) => (v.start_min === undefined) === (v.end_min === undefined), {
    message: 'start_min and end_min must both be present or both be absent',
    path: ['end_min'],
  })
  .refine((v) => v.start_min === undefined || v.end_min === undefined || v.end_min > v.start_min, {
    message: 'end_min must be greater than start_min',
    path: ['end_min'],
  });
export type CreateClassSessionInput = z.infer<typeof createClassSessionSchema>;

// `status` is optional (v1.6, was required) so a PATCH can touch just
// `note` — omitted `status` leaves the two-way attend_class sync untouched
// (see updateClassSessionStatus).
export const updateClassSessionSchema = z.strictObject({
  status: z.enum(CLASS_SESSION_STATUSES).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type UpdateClassSessionInput = z.infer<typeof updateClassSessionSchema>;
