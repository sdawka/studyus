import { z } from 'zod';
import { idSchema, isoDatetimeSchema } from './common';

export const ASSESSMENT_TYPES = ['quiz', 'assignment', 'midterm', 'final', 'lab'] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export const createAssessmentSchema = z.strictObject({
  title: z.string().min(1),
  type: z.enum(ASSESSMENT_TYPES),
  due_date: isoDatetimeSchema.optional(),
  weight_pct: z.number().min(0).max(100).optional(),
  kc_ids: z.array(idSchema).optional(),
});
export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;

// Setting grade_received (with existing grade_max, or provided here) is the
// trigger for auto-appending one assessment event per linked assessment_kcs row.
export const updateAssessmentSchema = z.strictObject({
  title: z.string().min(1).optional(),
  type: z.enum(ASSESSMENT_TYPES).optional(),
  due_date: isoDatetimeSchema.nullable().optional(),
  weight_pct: z.number().min(0).max(100).nullable().optional(),
  grade_received: z.number().min(0).nullable().optional(),
  grade_max: z.number().min(0).nullable().optional(),
});
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentSchema>;
