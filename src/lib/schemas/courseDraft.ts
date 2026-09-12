import { z } from 'zod';

export const KC_FORMS = ['constant_constant', 'variable_constant', 'variable_variable'] as const;
export const INTENDED_PROCESSES = ['memory_fluency', 'induction_refinement', 'understanding_sensemaking'] as const;
export const EXPERIENCE_KINDS = ['scaffold', 'exercise', 'project'] as const;

const draftIdSchema = z.string().trim().min(1);

export const masteryRuleSchema = z.strictObject({
  threshold: z.number().min(0).max(1).optional(),
  minimum_evidence: z.number().int().min(1).optional(),
  requires_transfer: z.boolean().optional(),
  requires_retention: z.boolean().optional(),
});

export const courseSpecSchema = z.strictObject({
  title: z.string().trim().min(1),
  topic: z.string().trim().min(1),
  level: z.string().trim().min(1),
  project: z.string().trim().min(1).optional(),
  constraints: z.array(z.string().trim().min(1)).optional().default([]),
});

export const courseOutcomeSchema = z.strictObject({
  id: draftIdSchema,
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  kc_ids: z.array(draftIdSchema),
});

export const knowledgeComponentSchema = z.strictObject({
  id: draftIdSchema,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  kc_form: z.enum(KC_FORMS),
  rationale_level: z.number().int().min(1).max(3),
  mastery_rule: masteryRuleSchema,
  prerequisite_kc_ids: z.array(draftIdSchema).default([]),
});

export const courseExampleSchema = z.strictObject({
  id: draftIdSchema,
  kc_ids: z.array(draftIdSchema),
  content: z.unknown(),
});

export const courseMisconceptionSchema = z.strictObject({
  id: draftIdSchema,
  kc_ids: z.array(draftIdSchema),
  name: z.string().trim().min(1),
  diagnostic_probe: z.string().trim().min(1),
  correction: z.string().trim().min(1),
});

export const courseExperienceSchema = z.strictObject({
  id: draftIdSchema,
  kind: z.enum(EXPERIENCE_KINDS),
  target_kc_ids: z.array(draftIdSchema),
  intended_processes: z.array(z.enum(INTENDED_PROCESSES)),
  produces_evidence: z.boolean(),
  diagnostic_misconception_ids: z.array(draftIdSchema).default([]),
  content: z.unknown(),
});

export const courseReferenceSchema = z.strictObject({
  id: draftIdSchema,
  citation: z.string().trim().min(1),
  url: z.url().optional(),
  kc_ids: z.array(draftIdSchema).default([]),
  example_ids: z.array(draftIdSchema).default([]),
  experience_ids: z.array(draftIdSchema).default([]),
  misconception_ids: z.array(draftIdSchema).default([]),
});

export const courseModuleSchema = z.strictObject({
  id: draftIdSchema,
  title: z.string().trim().min(1),
  outcome_ids: z.array(draftIdSchema).default([]),
  kc_ids: z.array(draftIdSchema).default([]),
  experience_ids: z.array(draftIdSchema).default([]),
  sort_order: z.number().int().min(0),
});

export const courseDraftV2Schema = z.strictObject({
  schema_version: z.literal(2),
  spec: courseSpecSchema,
  outcomes: z.array(courseOutcomeSchema),
  kcs: z.array(knowledgeComponentSchema),
  examples: z.array(courseExampleSchema),
  misconceptions: z.array(courseMisconceptionSchema),
  experiences: z.array(courseExperienceSchema),
  references: z.array(courseReferenceSchema),
  modules: z.array(courseModuleSchema).default([]),
});

export type CourseDraftV2 = z.infer<typeof courseDraftV2Schema>;
