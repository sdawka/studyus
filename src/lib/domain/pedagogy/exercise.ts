// Exercise engine: item selection and evidence recording.  This is separate
// from route-oriented quick_quiz/exercise-attempt flows so every caller shares
// the purpose vocabulary and event provenance.
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DomainContext } from '../context';
import { exercises, misconceptions, userMisconceptions } from '../../../db/schema';
import { idSchema } from '../../schemas/common';
import { createEvent } from '../../services/events';
import { getExerciseWithAnswers } from '../../services/exercises';
import { getKcGraph } from '../../services/knowledgeMap';
import { advanceUserMisconception, requireOwnedMisconception } from '../../services/misconceptionLifecycle';
import { ConflictError, requireOwnedKc } from '../../services/util';

export const exercisePurposeSchema = z.enum(['placement', 'assessment', 'practice', 'diagnostic']);
export type ExercisePurpose = z.infer<typeof exercisePurposeSchema>;

export const selectExerciseSchema = z.strictObject({
  kc_id: idSchema,
  purpose: exercisePurposeSchema,
  count: z.number().int().min(1).max(10).default(1),
});

function preferredDifficulty(mastery: number): number {
  if (mastery < 40) return 1;
  if (mastery < 80) return 2;
  return 3;
}

const generatedMcqSchema = z.strictObject({
  kind: z.literal('mcq'),
  difficulty: z.number().int().min(1).max(3).default(2),
  prompt: z.string().min(1),
  details: z.strictObject({
    options: z.array(z.string().min(1)).min(3).max(5),
    correct_index: z.number().int().min(0),
    explanation: z.string().min(1),
  }).superRefine((details, issue) => {
    if (details.correct_index >= details.options.length) {
      issue.addIssue({ code: 'custom', path: ['correct_index'], message: 'correct_index must reference an option' });
    }
  }),
});

const generatedNumericSchema = z.strictObject({
  kind: z.literal('numeric'),
  difficulty: z.number().int().min(1).max(3).default(2),
  prompt: z.string().min(1),
  details: z.strictObject({
    answer: z.strictObject({ value: z.number(), unit: z.string().nullable(), tolerance_pct: z.number().nonnegative().default(2) }),
    solution: z.string().min(1),
  }),
});

const generatedWorkedSchema = z.strictObject({
  kind: z.literal('worked'),
  difficulty: z.number().int().min(1).max(3).default(2),
  prompt: z.string().min(1),
  details: z.strictObject({ solution: z.string().min(1) }),
});

export const persistGeneratedExercisesSchema = z.strictObject({
  kc_id: idSchema,
  // The generator identity is provenance for content review. It must be an
  // explicit caller value rather than an implicit provider secret or model.
  generator: z.string().min(1).max(200),
  // A generator may retry after a transport failure. With this id, retries
  // return the original durable bank rows instead of duplicating content.
  request_id: idSchema.optional(),
  items: z.array(z.discriminatedUnion('kind', [generatedMcqSchema, generatedNumericSchema, generatedWorkedSchema])).min(1).max(10),
});

const recordExerciseEvidenceSchema = z
  .strictObject({
    kc_id: idSchema,
    purpose: exercisePurposeSchema,
    correct: z.boolean(),
    exercise_id: idSchema.optional(),
    misconception_id: idSchema.optional(),
    // A caller-controlled attempt id makes delivery retries idempotent. It
    // becomes the canonical event id, so the event stream has one fact per
    // completed attempt rather than one fact per network delivery.
    event_id: idSchema.optional(),
  })
  .superRefine((input, issue) => {
    if (input.misconception_id && input.purpose !== 'diagnostic') {
      issue.addIssue({ code: 'custom', path: ['misconception_id'], message: 'misconception_id is only valid for diagnostic evidence' });
    }
  });

type CalibrationKc = { kc_id: string; depth: number; mastery: number };

async function orderedExercisesForKc(ctx: DomainContext, kcId: string, mastery: number) {
  const rows = await ctx.db
    .select()
    .from(exercises)
    .where(eq(exercises.kcId, kcId))
    .orderBy(asc(exercises.sortOrder));
  const target = preferredDifficulty(mastery);
  return [...rows].sort((a, b) => {
    const distance = Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target);
    return distance || a.sortOrder - b.sortOrder;
  });
}

/** Selects the closest bank item(s), favouring the learner's current ZPD. */
export async function selectExercises(ctx: DomainContext, input: z.input<typeof selectExerciseSchema>) {
  const parsed = selectExerciseSchema.parse(input);
  const kc = await requireOwnedKc(ctx.db, ctx.userId, parsed.kc_id);
  if (parsed.purpose === 'placement') {
    const graph = await getKcGraph(ctx.db, ctx.userId, kc.id);
    // Placement starts at the furthest prerequisites and walks toward the
    // requested KC. This is deliberately graph-shaped calibration, not a
    // special case that always picks difficulty-1 items from the target.
    const calibrationKcs: CalibrationKc[] = [
      ...graph.prereqs
        .map((prereq) => ({ kc_id: prereq.kc_id, depth: prereq.depth, mastery: prereq.mastery }))
        .sort((a, b) => b.depth - a.depth || a.kc_id.localeCompare(b.kc_id)),
      { kc_id: kc.id, depth: 0, mastery: kc.mastery },
    ];
    const selected = [] as (typeof exercises.$inferSelect)[];
    const generationNeeded: string[] = [];
    for (const candidate of calibrationKcs) {
      if (selected.length >= parsed.count) break;
      const candidateItems = await orderedExercisesForKc(ctx, candidate.kc_id, candidate.mastery);
      if (candidateItems.length === 0) {
        generationNeeded.push(candidate.kc_id);
        continue;
      }
      selected.push(candidateItems[0]!);
    }
    return {
      purpose: parsed.purpose,
      kc,
      exercises: selected,
      calibration_kcs: calibrationKcs,
      generation_needed_for_kc_ids: generationNeeded,
    };
  }

  const ordered = await orderedExercisesForKc(ctx, kc.id, kc.mastery);
  if (parsed.purpose !== 'diagnostic') {
    return {
      purpose: parsed.purpose,
      kc,
      exercises: ordered.slice(0, parsed.count),
      generation_needed_for_kc_ids: ordered.length < parsed.count ? [kc.id] : [],
    };
  }

  const known = await ctx.db.select().from(misconceptions).where(eq(misconceptions.kcId, kc.id));
  // Diagnostic probes are content, not an invented LLM conclusion.  The
  // caller may generate a bank item only when this explicit list is empty.
  return {
    purpose: parsed.purpose,
    kc,
    exercises: ordered.slice(0, parsed.count),
    misconceptions: known,
    generation_needed_for_kc_ids: ordered.length < parsed.count ? [kc.id] : [],
  };
}

/**
 * Persists validated model-produced items as durable bank content. Generated
 * bank rows are the documented exception to the event stream: no learner
 * action happened yet, so this function must not create a synthetic event.
 */
export async function persistGeneratedExercises(ctx: DomainContext, input: z.input<typeof persistGeneratedExercisesSchema>) {
  const parsed = persistGeneratedExercisesSchema.parse(input);
  await requireOwnedKc(ctx.db, ctx.userId, parsed.kc_id);
  const retrySlugs = parsed.request_id ? parsed.items.map((_, index) => `generated-${parsed.request_id}-${index}`) : null;
  if (retrySlugs) {
    const existing = await ctx.db
      .select()
      .from(exercises)
      .where(and(eq(exercises.kcId, parsed.kc_id), inArray(exercises.slug, retrySlugs)))
      .orderBy(asc(exercises.sortOrder));
    if (existing.length > 0) {
      if (existing.length !== parsed.items.length) throw new ConflictError('Generated exercise request was only partially persisted');
      return existing;
    }
  }
  const now = ctx.now ?? Date.now();
  const created = parsed.items.map((item, index) => ({
    id: crypto.randomUUID(),
    kcId: parsed.kc_id,
    slug: retrySlugs?.[index] ?? `generated-${crypto.randomUUID()}`,
    kind: item.kind,
    difficulty: item.difficulty,
    prompt: item.prompt,
    details: item.details,
    source: `generated:${parsed.generator}`,
    origin: 'generated' as const,
    sortOrder: now + index,
    createdAt: now,
  }));
  await ctx.db.insert(exercises).values(created);
  return created;
}

/** Records all exercise outcomes through the event writer; never mutates mastery. */
export async function recordExerciseEvidence(
  ctx: DomainContext,
  input: z.input<typeof recordExerciseEvidenceSchema>,
) {
  const parsed = recordExerciseEvidenceSchema.parse(input);
  const kc = await requireOwnedKc(ctx.db, ctx.userId, parsed.kc_id);
  if (parsed.exercise_id) {
    const exercise = await getExerciseWithAnswers(ctx.db, ctx.userId, parsed.exercise_id);
    if (exercise.kcId !== kc.id) throw new Error('Exercise evidence must belong to the evidence KC');
  }
  let misconception = null;
  if (parsed.misconception_id) {
    misconception = await requireOwnedMisconception(ctx.db, ctx.userId, parsed.misconception_id);
    if (misconception.kcId !== kc.id) throw new Error('Diagnostic misconception must belong to the evidence KC');
  }

  const type = parsed.purpose === 'placement' ? 'placement_probe' : parsed.purpose === 'diagnostic' ? 'diagnostic_probe' : 'retrieval_practice';
  const result = await createEvent(
    ctx.db,
    ctx.userId,
    {
      type: type as Parameters<typeof createEvent>[2]['type'],
      kc_id: kc.id,
      payload: {
        correct: parsed.correct,
        exercise_id: parsed.exercise_id,
        misconception_id: parsed.misconception_id,
        purpose: parsed.purpose,
        channel: ctx.channel ?? 'web',
      },
      event_id: parsed.event_id,
    },
    'tutor',
  );

  // An incorrect diagnostic response is the evidence that can surface a
  // known belief. The first probe marks it suspected; a later probe confirms
  // it. The lifecycle service prevents regression after remediation.
  let misconceptionLifecycle = null;
  if (misconception && !parsed.correct && result.wasCreated) {
    const prior = await ctx.db
      .select({ status: userMisconceptions.status })
      .from(userMisconceptions)
      .where(and(eq(userMisconceptions.userId, ctx.userId), eq(userMisconceptions.misconceptionId, misconception.id)))
      .limit(1);
    misconceptionLifecycle = await advanceUserMisconception(ctx.db, ctx.userId, {
      misconception_id: misconception.id,
      status: prior[0]?.status === 'suspected' ? 'confirmed' : 'suspected',
      evidence_event_id: result.event.id,
    });
  }
  return { ...result, misconception_lifecycle: misconceptionLifecycle };
}
