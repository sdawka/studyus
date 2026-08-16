import { z } from 'zod';
import { idSchema } from './common';

// v1.7: the user's accepted-correction ledger. Entries are created either
// when a tutor's fenced correction_proposal (absorb flow) is accepted by the
// client, or manually. `accepted_at` is always stamped server-side — never
// client-settable.
export const CORRECTION_STATUSES = ['active', 'internalized'] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const listCorrectionsQuerySchema = z.strictObject({
  status: z.enum(CORRECTION_STATUSES).optional(),
});
export type ListCorrectionsQuery = z.infer<typeof listCorrectionsQuerySchema>;

export const createCorrectionSchema = z.strictObject({
  kc_id: idSchema.optional(),
  misconception_id: idSchema.optional(),
  prior_belief: z.string().max(2000).optional(),
  correction: z.string().min(1).max(2000),
  source_conversation_id: idSchema.optional(),
});
export type CreateCorrectionInput = z.infer<typeof createCorrectionSchema>;

export const updateCorrectionSchema = z.strictObject({
  status: z.enum(CORRECTION_STATUSES).optional(),
});
export type UpdateCorrectionInput = z.infer<typeof updateCorrectionSchema>;
