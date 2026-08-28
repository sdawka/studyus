import { z } from 'zod';
import { EVENT_TYPES } from '../schemas/events';
import { DEMO_SCENARIO_IDS } from '../schemas/onboarding';
import { NOTIFICATION_TYPES } from '../schemas/notifications';
import { TASK_TYPES } from '../schemas/tasks';
import { TUTOR_MODES } from '../schemas/tutor';

const opaqueIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9:_-]+$/);
const routePatternSchema = z
  .string()
  .min(1)
  .max(200)
  .startsWith('/')
  .refine((value) => !/[?#]/.test(value) && !value.includes('://'), 'Expected an Astro route pattern');
const countSchema = z.number().int().min(0).max(100_000);
const durationSchema = z.number().int().min(0).max(86_400_000);

const baseProperties = {
  user_id: opaqueIdSchema.optional(),
  session_id: opaqueIdSchema,
  surface: routePatternSchema,
  ts: z.number().int().positive(),
  viewport: z.enum(['mobile', 'tablet', 'desktop']).optional(),
};

function event<const Name extends string, Shape extends z.ZodRawShape>(name: Name, shape: Shape) {
  return z.strictObject({ name: z.literal(name), ...baseProperties, ...shape });
}

const empty = {};
const trialBase = { trial_session_id: opaqueIdSchema };
const recommendation = { recommendation_id: opaqueIdSchema, rank: z.number().int().min(1).max(100) };
const calendarProvider = { provider: z.enum(['google', 'microsoft']) };
const misconception = { misconception_id: opaqueIdSchema };

// The sole behavioral vocabulary. Keep names and allowed properties here: callers
// must parse through this union before either browser or Worker transport.
export const behavioralEventSchemas = [
  event('landing_try_clicked', trialBase),
  event('setup_step_completed', { ...trialBase, step: z.enum(['context', 'preferences', 'course']) }),
  event('setup_step_skipped', { ...trialBase, step: z.enum(['context', 'preferences', 'course']) }),
  event('demo_entered', trialBase),
  event('scenario_started', { ...trialBase, scenario_id: z.enum(DEMO_SCENARIO_IDS) }),
  event('scenario_completed', { ...trialBase, scenario_id: z.enum(DEMO_SCENARIO_IDS) }),
  event('signup_clicked', trialBase),
  event('import_offered', trialBase),
  event('import_accepted', trialBase),
  event('import_declined', trialBase),
  event('onboarding_completed', trialBase),
  event('page_viewed', { route: routePatternSchema, referrer_route: routePatternSchema.nullable().optional() }),
  event('signup_completed', {
    method: z.enum(['email', 'phone', 'oauth', 'unknown']),
    trial_session_id: opaqueIdSchema.optional(),
  }),
  event('onboarding_path_chosen', {
    path: z.enum(['template', 'manual', 'document']),
    import_from_trial: z.boolean(),
  }),
  event('onboarding_map_reviewed', {
    renamed: countSchema,
    reordered: countSchema,
    excluded: countSchema,
    template_id: opaqueIdSchema.optional(),
  }),
  event('onboarding_completed_auth', { course_count: countSchema, kc_count: countSchema, duration_ms: durationSchema }),
  event('app_session_started', { entry_route: routePatternSchema, days_since_last_session: countSchema.optional() }),
  event('next_move_viewed', {
    ...recommendation,
    kind: z.enum(['assessment_practice', 'prerequisite_repair', 'stale_review', 'frontier_understand']),
    available_minutes: z.union([z.literal(15), z.literal(25), z.literal(50)]),
  }),
  event('recommendation_followed', recommendation),
  event('recommendation_ignored', recommendation),
  event('task_checked', { task_type: z.enum(TASK_TYPES), source_surface: routePatternSchema, overdue: z.boolean() }),
  event('task_dismissed', { task_type: z.enum(TASK_TYPES), source_surface: routePatternSchema }),
  event('record_event_opened', empty),
  event('record_event_submitted', { event_type: z.enum(EVENT_TYPES) }),
  event('notification_opened', { notification_type: z.enum(NOTIFICATION_TYPES) }),
  event('resource_opened', { resource_id: opaqueIdSchema, origin: z.enum(['feed', 'course', 'shared']) }),
  event('resource_saved', { resource_id: opaqueIdSchema, course_id: opaqueIdSchema }),
  event('practice_started', {
    course_id: opaqueIdSchema,
    intended_event_type: z.enum(EVENT_TYPES),
    ritual_id: opaqueIdSchema.optional(),
  }),
  event('practice_abandoned', { elapsed_ms: durationSchema, stage: z.enum(['setup', 'practice', 'reflection']) }),
  event('quiz_started', { kc_ids: z.array(opaqueIdSchema).min(1).max(100), question_count: countSchema }),
  event('quiz_abandoned', { kc_ids: z.array(opaqueIdSchema).min(1).max(100), answered_count: countSchema }),
  event('tutor_opened', {
    conversation_id: opaqueIdSchema,
    mode: z.enum(TUTOR_MODES),
    kc_id: opaqueIdSchema,
    entry: z.enum(['direct', 'next_move', 'absorb', 'course']),
  }),
  event('tutor_message_sent', { conversation_id: opaqueIdSchema, turn_index: countSchema }),
  event('tutor_abandoned', { conversation_id: opaqueIdSchema, turn_count: countSchema, elapsed_ms: durationSchema }),
  event('absorb_stage_reached', { kc_id: opaqueIdSchema, stage: z.number().int().min(1).max(4) }),
  event('prereq_gate_decided', {
    kc_id: opaqueIdSchema,
    choice: z.enum(['verify', 'continue_anyway']),
    weak_count: countSchema,
  }),
  event('misconception_card_shown', { ...misconception, conversation_id: opaqueIdSchema }),
  event('misconception_accepted', misconception),
  event('misconception_dismissed', misconception),
  event('attendance_toggled', {
    course_id: opaqueIdSchema,
    status: z.enum(['attended', 'missed', 'unmarked']),
    sessions_behind: countSchema,
  }),
  event('calendar_connect_started', calendarProvider),
  event('calendar_connected', calendarProvider),
  event('calendar_connect_failed', calendarProvider),
  event('settings_changed', {
    keys: z
      .array(z.enum(['theme', 'scheme', 'sidebar_collapsed', 'task_generators', 'learning_preferences', 'analytics_opt_out']))
      .min(1)
      .max(6),
  }),
  event('course_archived', { course_id: opaqueIdSchema, weeks_since_added: countSchema }),
  event('correction_internalized', { correction_id: opaqueIdSchema, days_since_accepted: countSchema }),
] as const;

export const behavioralEventSchema = z.discriminatedUnion('name', behavioralEventSchemas);
export type BehavioralEvent = z.infer<typeof behavioralEventSchema>;
export type BehavioralEventName = BehavioralEvent['name'];
type BehavioralBaseProperty = 'user_id' | 'session_id' | 'surface' | 'ts' | 'viewport';
export type BehavioralEventInput = BehavioralEvent extends infer Event
  ? Event extends BehavioralEvent
    ? Omit<Event, BehavioralBaseProperty>
    : never
  : never;
export type BehavioralBaseProperties = Pick<BehavioralEvent, BehavioralBaseProperty>;

export const behavioralEventNames = behavioralEventSchemas.map((schema) => schema.shape.name.value) as BehavioralEventName[];

const schemaByName = new Map<BehavioralEventName, (typeof behavioralEventSchemas)[number]>(
  behavioralEventSchemas.map((schema) => [schema.shape.name.value, schema]),
);

export function parseBehavioralEvent(input: unknown): BehavioralEvent {
  return behavioralEventSchema.parse(input);
}

export function enrichBehavioralEvent(
  input: BehavioralEventInput,
  base: BehavioralBaseProperties,
): BehavioralEvent | undefined {
  const parsed = behavioralEventSchema.safeParse({ ...input, ...base });
  return parsed.success ? parsed.data : undefined;
}

export function behavioralSchemaFor(name: string) {
  return schemaByName.get(name as BehavioralEventName);
}
