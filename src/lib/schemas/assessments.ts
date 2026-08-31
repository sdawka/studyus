import { z } from 'zod';
import { idSchema, isoDatetimeSchema } from './common';
import { ASSESSMENT_KINDS, ASSESSMENT_TYPES } from '../assessments';

// The type and kind vocabularies live in src/lib/assessments.ts — a leaf with
// no runtime imports — so the browser islands that render assessments can have
// them without pulling zod in with them. Re-exported here so server callers can
// keep importing everything about assessments from the schema module.
export { ASSESSMENT_TYPES, ASSESSMENT_KINDS } from '../assessments';
export type { AssessmentType, AssessmentKind } from '../assessments';

export const createAssessmentSchema = z.strictObject({
  title: z.string().min(1).max(300),
  type: z.enum(ASSESSMENT_TYPES),
  due_date: isoDatetimeSchema.optional(),
  weight_pct: z.number().min(0).max(100).optional(),
  kc_ids: z.array(idSchema).optional(),
  kind: z.enum(ASSESSMENT_KINDS).optional(),
});
export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;

// Setting grade_received (with existing grade_max, or provided here) is the
// trigger for auto-appending one assessment event per linked assessment_kcs row.
export const updateAssessmentSchema = z.strictObject({
  title: z.string().min(1).max(300).optional(),
  type: z.enum(ASSESSMENT_TYPES).optional(),
  due_date: isoDatetimeSchema.nullable().optional(),
  weight_pct: z.number().min(0).max(100).nullable().optional(),
  grade_received: z.number().min(0).nullable().optional(),
  grade_max: z.number().min(0).nullable().optional(),
  kind: z.enum(ASSESSMENT_KINDS).optional(),
  // Task-centric platform (v1.4): replace-links (not additive) — an empty
  // array clears all KC links. Ids are validated against the assessment's
  // course in services/assessments.ts (a DB lookup, not expressible here).
  kc_ids: z.array(idSchema).optional(),
});
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentSchema>;
