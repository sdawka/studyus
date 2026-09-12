import { z } from 'zod';

export const KC_FORMS = ['constant_constant', 'variable_constant', 'variable_variable'] as const;
export const INTENDED_PROCESSES = ['memory_fluency', 'induction_refinement', 'understanding_sensemaking'] as const;
export const EXPERIENCE_KINDS = ['scaffold', 'exercise', 'project'] as const;
export const EVIDENCE_RESPONSE_TYPES = ['selected_response', 'constructed_response', 'performance', 'observation'] as const;
export const EVIDENCE_SCORING_KINDS = ['binary', 'numeric', 'rubric'] as const;

export const SCAFFOLD_KINDS = [
  'retrieval_prompt',
  'mnemonic',
  'matching_drill',
  'classification_task',
  'contrast_examples',
  'worked_example',
  'procedure_outline',
  'self_explanation_prompt',
  'derivation_walkthrough',
  'interactive_model',
  'analogy',
] as const;

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

export const textExampleContentSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal('text'),
  body: z.string().trim().min(1),
});

export const contrastExampleContentSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal('contrast'),
  positive: z.string().trim().min(1),
  negative: z.string().trim().min(1),
  explanation: z.string().trim().min(1).optional(),
});

export const genericExampleContentSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal('generic'),
  data: z.record(z.string(), z.unknown()),
});

export const exampleContentSchema = z.discriminatedUnion('kind', [
  textExampleContentSchema,
  contrastExampleContentSchema,
  genericExampleContentSchema,
]);

export const courseExampleSchema = z.strictObject({
  id: draftIdSchema,
  kc_ids: z.array(draftIdSchema),
  content: exampleContentSchema,
});

export const courseMisconceptionSchema = z.strictObject({
  id: draftIdSchema,
  kc_ids: z.array(draftIdSchema),
  name: z.string().trim().min(1),
  diagnostic_probe: z.string().trim().min(1),
  correction: z.string().trim().min(1),
});

export const binaryScoringDetailsSchema = z.strictObject({
  schema_version: z.literal(1),
  correct_response: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const numericScoringDetailsSchema = z.strictObject({
  schema_version: z.literal(1),
  answer: z.strictObject({
    value: z.number(),
    unit: z.string().nullable().optional(),
    tolerance_pct: z.number().min(0).optional(),
  }),
});

export const rubricScoringDetailsSchema = z.strictObject({
  schema_version: z.literal(1),
  criteria: z.array(z.strictObject({
    id: draftIdSchema,
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    max_points: z.number().positive().optional(),
  })).min(1),
});

export const evidenceScoringSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('binary'), details: binaryScoringDetailsSchema.optional() }),
  z.strictObject({ kind: z.literal('numeric'), details: numericScoringDetailsSchema.optional() }),
  z.strictObject({ kind: z.literal('rubric'), details: rubricScoringDetailsSchema.optional() }),
]);

export const evidenceSpecSchema = z.strictObject({
  response_type: z.enum(EVIDENCE_RESPONSE_TYPES),
  target_kc_ids: z.array(draftIdSchema).min(1),
  diagnostic_misconception_ids: z.array(draftIdSchema).default([]),
  scoring: evidenceScoringSchema.optional(),
});

const experienceBase = {
  id: draftIdSchema,
  target_kc_ids: z.array(draftIdSchema),
  intended_processes: z.array(z.enum(INTENDED_PROCESSES)),
  evidence: evidenceSpecSchema.optional(),
};

export const scaffoldExperienceContentSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal('scaffold'),
  scaffold_kind: z.enum(SCAFFOLD_KINDS),
  level: z.number().int().min(1).max(3),
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

export const mcqExperienceContentSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal('mcq'),
  prompt: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).min(2),
  correct_index: z.number().int().min(0),
  explanation: z.string().trim().min(1),
  difficulty: z.number().int().min(1).max(3).optional(),
  source: z.string().trim().min(1).optional(),
}).refine((content) => content.correct_index < content.options.length, {
  path: ['correct_index'],
  message: 'Correct index must identify an option',
});

export const numericExperienceContentSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal('numeric'),
  prompt: z.string().trim().min(1),
  answer: z.strictObject({ value: z.number(), unit: z.string().nullable(), tolerance_pct: z.number().min(0) }),
  solution: z.string().trim().min(1),
  difficulty: z.number().int().min(1).max(3).optional(),
  source: z.string().trim().min(1).optional(),
});

export const workedExperienceContentSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal('worked'),
  prompt: z.string().trim().min(1),
  solution: z.string().trim().min(1),
  difficulty: z.number().int().min(1).max(3).optional(),
  source: z.string().trim().min(1).optional(),
});

export const projectExperienceContentSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal('project'),
  title: z.string().trim().min(1),
  brief: z.string().trim().min(1),
  deliverable: z.string().trim().min(1).optional(),
  rubric: z.array(z.string().trim().min(1)).optional(),
});

export const courseExperienceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...experienceBase, kind: z.literal('scaffold'), content: scaffoldExperienceContentSchema }),
  z.strictObject({
    ...experienceBase,
    kind: z.literal('exercise'),
    content: z.union([mcqExperienceContentSchema, numericExperienceContentSchema, workedExperienceContentSchema]),
  }),
  z.strictObject({ ...experienceBase, kind: z.literal('project'), content: projectExperienceContentSchema }),
]);

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
  outcomes: z.array(courseOutcomeSchema).min(1),
  kcs: z.array(knowledgeComponentSchema).min(1),
  examples: z.array(courseExampleSchema).min(1),
  misconceptions: z.array(courseMisconceptionSchema),
  experiences: z.array(courseExperienceSchema).min(1),
  references: z.array(courseReferenceSchema),
  modules: z.array(courseModuleSchema).default([]),
});

export type CourseDraftV2 = z.infer<typeof courseDraftV2Schema>;
