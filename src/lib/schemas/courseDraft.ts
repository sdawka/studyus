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

const shortStringSchema = z.string().trim().min(1).max(200);
const longStringSchema = z.string().trim().min(1).max(20_000);
const draftIdSchema = z.string().trim().min(1).max(128);
const relationIdsSchema = z.array(draftIdSchema).max(300);
const selectionPolicySchema = z.strictObject({
  evidence_tags: z.array(z.enum(['spacing', 'retention', 'transfer'])).max(3).default([]),
});
const selectionPolicyField = { selection_policy: selectionPolicySchema.optional() };

function boundedGeneric(value: Record<string, unknown>): boolean {
  try { return Object.keys(value).length <= 50 && JSON.stringify(value).length <= 65_536; } catch { return false; }
}

export const masteryRuleSchema = z.strictObject({
  threshold: z.number().min(0).max(1).optional(),
  minimum_evidence: z.number().int().min(1).optional(),
  requires_transfer: z.boolean().optional(),
  requires_retention: z.boolean().optional(),
});

export const courseSpecSchema = z.strictObject({
  title: shortStringSchema,
  topic: shortStringSchema,
  level: shortStringSchema,
  project: longStringSchema.optional(),
  constraints: z.array(z.string().trim().min(1).max(500)).max(50).optional().default([]),
});

export const courseOutcomeSchema = z.strictObject({
  id: draftIdSchema,
  title: shortStringSchema,
  description: longStringSchema.optional(),
  kc_ids: relationIdsSchema,
});

export const knowledgeComponentSchema = z.strictObject({
  id: draftIdSchema,
  name: shortStringSchema,
  description: longStringSchema.optional(),
  kc_form: z.enum(KC_FORMS),
  rationale_level: z.number().int().min(1).max(3),
  mastery_rule: masteryRuleSchema,
  prerequisite_kc_ids: relationIdsSchema.default([]),
});

export const textExampleContentSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal('text'),
  body: longStringSchema,
});

export const contrastExampleContentSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal('contrast'),
  positive: longStringSchema,
  negative: longStringSchema,
  explanation: longStringSchema.optional(),
});

export const genericExampleContentSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal('generic'),
  data: z.record(z.string().max(100), z.unknown()).refine(boundedGeneric, 'Generic content is too large'),
});

export const exampleContentSchema = z.discriminatedUnion('kind', [
  textExampleContentSchema,
  contrastExampleContentSchema,
  genericExampleContentSchema,
]);

export const courseExampleSchema = z.strictObject({
  id: draftIdSchema,
  kc_ids: relationIdsSchema,
  content: exampleContentSchema,
});

export const courseMisconceptionSchema = z.strictObject({
  id: draftIdSchema,
  kc_ids: relationIdsSchema,
  name: shortStringSchema,
  diagnostic_probe: longStringSchema,
  correction: longStringSchema,
});

export const binaryScoringDetailsSchema = z.strictObject({
  schema_version: z.literal(1),
  correct_response: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const numericScoringDetailsSchema = z.strictObject({
  schema_version: z.literal(1),
  answer: z.strictObject({
    value: z.number(),
    unit: shortStringSchema.nullable().optional(),
    tolerance_pct: z.number().min(0).optional(),
  }),
});

export const rubricScoringDetailsSchema = z.strictObject({
  schema_version: z.literal(1),
  criteria: z.array(z.strictObject({
    id: draftIdSchema,
    label: shortStringSchema,
    description: longStringSchema.optional(),
    max_points: z.number().positive().optional(),
  })).min(1).max(50),
});

export const evidenceScoringSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('binary'), details: binaryScoringDetailsSchema.optional() }),
  z.strictObject({ kind: z.literal('numeric'), details: numericScoringDetailsSchema.optional() }),
  z.strictObject({ kind: z.literal('rubric'), details: rubricScoringDetailsSchema.optional() }),
]);

export const evidenceSpecSchema = z.strictObject({
  response_type: z.enum(EVIDENCE_RESPONSE_TYPES),
  target_kc_ids: relationIdsSchema.min(1),
  diagnostic_misconception_ids: relationIdsSchema.default([]),
  scoring: evidenceScoringSchema.optional(),
});

const experienceBase = {
  id: draftIdSchema,
  target_kc_ids: relationIdsSchema,
  intended_processes: z.array(z.enum(INTENDED_PROCESSES)).max(3),
  evidence: evidenceSpecSchema.optional(),
};

export const scaffoldExperienceContentSchema = z.strictObject({
  ...selectionPolicyField,
  schema_version: z.literal(1),
  kind: z.literal('scaffold'),
  scaffold_kind: z.enum(SCAFFOLD_KINDS),
  level: z.number().int().min(1).max(3),
  title: shortStringSchema,
  body: longStringSchema,
});

export const mcqExperienceContentSchema = z.strictObject({
  ...selectionPolicyField,
  schema_version: z.literal(1),
  kind: z.literal('mcq'),
  prompt: longStringSchema,
  options: z.array(shortStringSchema).min(2).max(20),
  correct_index: z.number().int().min(0),
  explanation: longStringSchema,
  difficulty: z.number().int().min(1).max(3).optional(),
  source: shortStringSchema.optional(),
}).refine((content) => content.correct_index < content.options.length, {
  path: ['correct_index'],
  message: 'Correct index must identify an option',
});

export const numericExperienceContentSchema = z.strictObject({
  ...selectionPolicyField,
  schema_version: z.literal(1),
  kind: z.literal('numeric'),
  prompt: longStringSchema,
  answer: z.strictObject({ value: z.number(), unit: shortStringSchema.nullable(), tolerance_pct: z.number().min(0) }),
  solution: longStringSchema,
  difficulty: z.number().int().min(1).max(3).optional(),
  source: shortStringSchema.optional(),
});

export const workedExperienceContentSchema = z.strictObject({
  ...selectionPolicyField,
  schema_version: z.literal(1),
  kind: z.literal('worked'),
  prompt: longStringSchema,
  solution: longStringSchema,
  difficulty: z.number().int().min(1).max(3).optional(),
  source: shortStringSchema.optional(),
});

export const projectExperienceContentSchema = z.strictObject({
  ...selectionPolicyField,
  schema_version: z.literal(1),
  kind: z.literal('project'),
  title: shortStringSchema,
  brief: longStringSchema,
  deliverable: longStringSchema.optional(),
  rubric: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
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
  citation: longStringSchema,
  url: z.url().max(2048).optional(),
  kc_ids: relationIdsSchema.default([]),
  example_ids: relationIdsSchema.default([]),
  experience_ids: relationIdsSchema.default([]),
  misconception_ids: relationIdsSchema.default([]),
});

export const courseModuleSchema = z.strictObject({
  id: draftIdSchema,
  title: shortStringSchema,
  outcome_ids: relationIdsSchema.default([]),
  kc_ids: relationIdsSchema.default([]),
  experience_ids: relationIdsSchema.default([]),
  sort_order: z.number().int().min(0),
});

export const courseDraftV2Schema = z.strictObject({
  schema_version: z.literal(2),
  spec: courseSpecSchema,
  outcomes: z.array(courseOutcomeSchema).min(1).max(100),
  kcs: z.array(knowledgeComponentSchema).min(1).max(300),
  examples: z.array(courseExampleSchema).min(1).max(500),
  misconceptions: z.array(courseMisconceptionSchema).max(300),
  experiences: z.array(courseExperienceSchema).min(1).max(500),
  references: z.array(courseReferenceSchema).max(500),
  modules: z.array(courseModuleSchema).max(100).default([]),
}).refine((draft) => (
  draft.outcomes.length + draft.kcs.length + draft.examples.length + draft.misconceptions.length
  + draft.experiences.length + draft.references.length + draft.modules.length <= 1_000
), { message: 'Course aggregate exceeds 1000 records' });

export type CourseDraftV2 = z.infer<typeof courseDraftV2Schema>;
