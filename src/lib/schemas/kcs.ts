import { z } from 'zod';

export const KC_TYPES = ['fact', 'association', 'concept', 'rule', 'principle'] as const;
export type KcType = (typeof KC_TYPES)[number];

export const updateKcSchema = z.strictObject({
  name: z.string().min(1).optional(),
  kc_type: z.enum(KC_TYPES).optional(),
  description: z.string().nullable().optional(),
  practice_notes: z.string().nullable().optional(),
});
export type UpdateKcInput = z.infer<typeof updateKcSchema>;
