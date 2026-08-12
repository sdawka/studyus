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

// Manual sessions only carry a date — status starts unmarked (null) and is
// set afterwards via PATCH /class-sessions/:id.
export const createClassSessionSchema = z.strictObject({
  date: isoDatetimeSchema,
});
export type CreateClassSessionInput = z.infer<typeof createClassSessionSchema>;

export const updateClassSessionSchema = z.strictObject({
  status: z.enum(CLASS_SESSION_STATUSES).nullable(),
});
export type UpdateClassSessionInput = z.infer<typeof updateClassSessionSchema>;
