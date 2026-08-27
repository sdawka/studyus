import { z } from 'zod';
import { CONTENT_KC_TYPES } from '../content/courseContent';

const existingOrClientId = z
  .strictObject({
    id: z.uuid().optional(),
    client_id: z.uuid().optional(),
  })
  .refine((value) => Boolean(value.id) !== Boolean(value.client_id), {
    message: 'Provide exactly one of id or client_id',
  });

export const courseMapKcSchema = existingOrClientId.safeExtend({
  name: z.string().trim().min(1).max(160),
  kc_type: z.enum(CONTENT_KC_TYPES),
  description: z.string().trim().max(1_200).nullable().default(null),
  practice_notes: z.string().trim().max(1_200).nullable().default(null),
  sort_order: z.number().int().min(0).max(10_000),
  archived: z.boolean().default(false),
  prerequisite_kc_ids: z.array(z.uuid()).max(100).default([]),
});

export const courseMapBranchSchema = existingOrClientId.safeExtend({
  name: z.string().trim().min(1).max(160),
  sort_order: z.number().int().min(0).max(10_000),
  archived: z.boolean().default(false),
  kcs: z.array(courseMapKcSchema).max(100),
});

export const updateCourseMapSchema = z.strictObject({
  expected_revision: z.number().int().positive(),
  branches: z.array(courseMapBranchSchema).min(1).max(60),
});
export type UpdateCourseMapInput = z.infer<typeof updateCourseMapSchema>;

export const templateUpdateActionSchema = z.strictObject({
  item_kind: z.enum(['branch', 'kc']),
  template_ref: z.string().trim().min(1).max(200),
  action: z.enum(['include', 'dismiss', 'archive', 'keep']),
});

export const applyTemplateUpdatesSchema = z.strictObject({
  expected_revision: z.number().int().positive(),
  actions: z.array(templateUpdateActionSchema).min(1).max(100),
});
export type ApplyTemplateUpdatesInput = z.infer<typeof applyTemplateUpdatesSchema>;
