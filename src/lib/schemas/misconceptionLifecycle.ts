import { z } from 'zod';
import { idSchema } from './common';

// Lifecycle order is intentional: diagnostics first surface a belief, a
// subsequent signal confirms it, an accepted correction starts remediation,
// and the learner later marks it internalized. Services only advance this
// order; they never regress a learner's state.
export const USER_MISCONCEPTION_STATUSES = ['suspected', 'confirmed', 'correcting', 'internalized'] as const;
export type UserMisconceptionStatus = (typeof USER_MISCONCEPTION_STATUSES)[number];

export const advanceUserMisconceptionSchema = z.strictObject({
  misconception_id: idSchema,
  status: z.enum(USER_MISCONCEPTION_STATUSES),
  evidence_event_id: idSchema.optional(),
});
export type AdvanceUserMisconceptionInput = z.infer<typeof advanceUserMisconceptionSchema>;
