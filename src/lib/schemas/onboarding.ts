import { z } from 'zod';

export const kcTypeSchema = z.enum(['fact', 'association', 'concept', 'rule', 'principle']);

export const courseSetupKcSchema = z.strictObject({
  client_id: z.string().uuid(),
  template_ref: z.string().trim().max(120).optional(),
  included: z.boolean().default(true),
  name: z.string().trim().min(2).max(160),
  kc_type: kcTypeSchema.default('concept'),
  description: z.string().trim().max(1200).optional(),
  sort_order: z.number().int().min(0).max(500).default(0),
  prereq_refs: z.array(z.string().trim().max(240)).max(40).default([]),
  source_refs: z.array(z.string().trim().max(240)).max(8).default([]),
});

export const courseSetupBranchSchema = z.strictObject({
  client_id: z.string().uuid(),
  template_ref: z.string().trim().max(120).optional(),
  included: z.boolean().default(true),
  name: z.string().trim().min(2).max(120),
  sort_order: z.number().int().min(0).max(500),
  kcs: z.array(courseSetupKcSchema).max(100),
});

export const courseSetupAssessmentSchema = z
  .strictObject({
    template_ref: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(300),
    type: z.enum(['quiz', 'assignment', 'midterm', 'final', 'lab']),
    kind: z.enum(['official', 'practice']),
    weight_pct: z.number().min(0).max(100).optional(),
    date_status: z.enum(['unset', 'confirmed', 'unknown']).default('unset'),
    due_on: z.string().date().optional(),
  })
  .superRefine((assessment, issue) => {
    if (assessment.date_status === 'confirmed' && !assessment.due_on) {
      issue.addIssue({ code: 'custom', path: ['due_on'], message: 'A confirmed assessment date is required' });
    }
    if (assessment.date_status !== 'confirmed' && assessment.due_on) {
      issue.addIssue({ code: 'custom', path: ['due_on'], message: 'Only confirmed assessments may include a date' });
    }
  });

export const courseSetupProposalSchema = z.strictObject({
  schema_version: z.literal(1),
  template_id: z.string().trim().max(120).optional(),
  template_revision: z.string().trim().max(80).optional(),
  course: z.strictObject({
    code: z.string().trim().min(2).max(32),
    title: z.string().trim().min(2).max(180),
    instructor: z.string().trim().max(120).optional(),
    credits: z.number().int().min(0).max(30).optional(),
  }),
  branches: z.array(courseSetupBranchSchema).min(1).max(40),
  assessments: z.array(courseSetupAssessmentSchema).max(40).default([]),
  source: z.strictObject({
    kind: z.enum(['template', 'manual', 'upload', 'simulated']),
    filename: z.string().trim().max(240).optional(),
  }),
});
export type CourseSetupProposal = z.infer<typeof courseSetupProposalSchema>;

export const learningPreferencesSchema = z.strictObject({
  weekly_hours: z.number().int().min(2).max(15),
  guidance: z.enum(['self_directed', 'balanced', 'tell_me_next']),
  depth: z.enum(['keep_up', 'understand', 'master']),
});
export type LearningPreferences = z.infer<typeof learningPreferencesSchema>;

export const learnerContextSchema = z
  .strictObject({
    institution_name: z.string().trim().min(2).max(160),
    program_name: z.string().trim().min(2).max(160).optional(),
    term_label: z.string().trim().min(2).max(80),
    starts_on: z.string().date(),
    ends_on: z.string().date(),
    timezone: z.string().trim().min(1).max(80),
  })
  .refine((term) => term.ends_on >= term.starts_on, { message: 'Semester end must be on or after its start', path: ['ends_on'] });
export type LearnerContext = z.infer<typeof learnerContextSchema>;

export const DEMO_SCENARIO_IDS = [
  'overloaded',
  'missed_lecture',
  'after_class',
  'false_fluency',
  'prerequisite_gap',
  'recurring_mistake',
  'exam_close',
  'grade_landed',
  'week_disrupted',
] as const;
export const demoScenarioIdSchema = z.enum(DEMO_SCENARIO_IDS);
export type DemoScenarioId = z.infer<typeof demoScenarioIdSchema>;

export const demoDraftSchema = z.strictObject({
  schema_version: z.literal(1),
  draft_id: z.string().uuid(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  context: learnerContextSchema.optional(),
  preferences: learningPreferencesSchema,
  courses: z.array(courseSetupProposalSchema).max(5),
  simulated: z.boolean(),
  completed_scenarios: z.array(demoScenarioIdSchema).max(DEMO_SCENARIO_IDS.length),
  demo_mastery: z.number().int().min(0).max(100),
  demo_standing: z.number().int().min(0).max(100),
});
export type DemoDraft = z.infer<typeof demoDraftSchema>;

export const demoImportSchema = demoDraftSchema.pick({
  schema_version: true,
  draft_id: true,
  context: true,
  preferences: true,
  courses: true,
});
export type DemoImportInput = z.infer<typeof demoImportSchema>;

export const DEMO_FUNNEL_EVENTS = [
  'landing_try_clicked',
  'setup_step_completed',
  'setup_step_skipped',
  'demo_entered',
  'scenario_started',
  'scenario_completed',
  'signup_clicked',
  'import_offered',
  'import_accepted',
  'import_declined',
  'onboarding_completed',
] as const;

export const demoFunnelEventSchema = z.strictObject({
  session_id: z.string().uuid(),
  event_id: z.string().uuid(),
  name: z.enum(DEMO_FUNNEL_EVENTS),
  step: z.enum(['context', 'preferences', 'course']).optional(),
  scenario_id: demoScenarioIdSchema.optional(),
  occurred_at: z.number().int().positive(),
});

export const demoFunnelBatchSchema = z.strictObject({
  events: z.array(demoFunnelEventSchema).min(1).max(20),
});
