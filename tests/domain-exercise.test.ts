import { env } from 'cloudflare:test';
import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, events, exercises, kcEdges, kcs, misconceptions, userMisconceptions, users } from '../src/db/schema';
import { persistGeneratedExercises, recordExerciseEvidence, selectExercises } from '../src/lib/domain/pedagogy/exercise';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let targetKcId: string;
let nearPrereqId: string;
let farPrereqId: string;
let misconceptionId: string;

function ctx() {
  return { db, userId, channel: 'exercise-test' };
}

async function seedExercise(kcId: string, overrides: Partial<typeof exercises.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db.insert(exercises).values({
    id,
    kcId,
    slug: overrides.slug ?? `exercise-${id}`,
    kind: overrides.kind ?? 'mcq',
    difficulty: overrides.difficulty ?? 2,
    prompt: overrides.prompt ?? 'Which answer is correct?',
    details: overrides.details ?? { options: ['A', 'B', 'C'], correct_index: 1, explanation: 'B is correct.' },
    source: overrides.source ?? 'test',
    origin: overrides.origin ?? 'seed',
    sortOrder: overrides.sortOrder ?? 0,
  });
  return id;
}

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  targetKcId = crypto.randomUUID();
  nearPrereqId = crypto.randomUUID();
  farPrereqId = crypto.randomUUID();
  misconceptionId = crypto.randomUUID();

  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `course-${courseId}`, title: 'Course' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Main' });
  await db.insert(kcs).values([
    { id: targetKcId, courseId, branchId, name: 'Target', kcType: 'concept', sortOrder: 2 },
    { id: nearPrereqId, courseId, branchId, name: 'Near prerequisite', kcType: 'concept', sortOrder: 1 },
    { id: farPrereqId, courseId, branchId, name: 'Far prerequisite', kcType: 'concept', mastery: 90, status: 'maintaining', sortOrder: 0 },
  ]);
  await db.insert(kcEdges).values([
    { id: crypto.randomUUID(), kcId: targetKcId, prereqKcId: nearPrereqId },
    { id: crypto.randomUUID(), kcId: nearPrereqId, prereqKcId: farPrereqId },
  ]);
  await db.insert(misconceptions).values({
    id: misconceptionId,
    kcId: targetKcId,
    slug: 'target-mistake',
    name: 'Target mistake',
    description: 'Incorrect target belief.',
    rootCause: 'Over-generalisation.',
    diagnosticProbe: 'Diagnostic question?',
    correction: 'Correct target belief.',
  });
});

describe('exercise domain — placement calibration', () => {
  it('walks prerequisites from the furthest dependency toward the target and appends placement evidence', async () => {
    const farEasy = await seedExercise(farPrereqId, { difficulty: 1, sortOrder: 0 });
    const farIndependent = await seedExercise(farPrereqId, { difficulty: 3, sortOrder: 1 });
    await seedExercise(nearPrereqId, { difficulty: 2 });
    await seedExercise(targetKcId, { difficulty: 1 });

    const selected = await selectExercises(ctx(), { kc_id: targetKcId, purpose: 'placement', count: 3 });
    const calibration = selected.calibration_kcs;
    if (!calibration) throw new Error('Placement selection must expose its calibration walk');
    expect(calibration.map((candidate) => candidate.kc_id)).toEqual([farPrereqId, nearPrereqId, targetKcId]);
    expect(selected.exercises.map((exercise) => exercise.kcId)).toEqual([farPrereqId, nearPrereqId, targetKcId]);
    // The already-strong foundational KC calibrates at independent difficulty,
    // proving placement is a graph walk with adaptive item choice, not a
    // target-KC difficulty-1 special case.
    expect(selected.exercises[0]?.id).toBe(farIndependent);
    expect(selected.exercises[0]?.id).not.toBe(farEasy);

    const eventId = crypto.randomUUID();
    await recordExerciseEvidence(ctx(), { kc_id: farPrereqId, purpose: 'placement', correct: true, event_id: eventId });
    const placementEvents = await db.select().from(events).where(eq(events.id, eventId));
    expect(placementEvents).toHaveLength(1);
    expect(placementEvents[0]).toMatchObject({ type: 'placement_probe', kcId: farPrereqId, isInstructional: false, isAssessment: true });
  });

  it('reports every missing calibration bank segment without inventing an item', async () => {
    await seedExercise(farPrereqId);
    const selected = await selectExercises(ctx(), { kc_id: targetKcId, purpose: 'placement', count: 3 });
    expect(selected.exercises.map((exercise) => exercise.kcId)).toEqual([farPrereqId]);
    expect(selected.generation_needed_for_kc_ids).toEqual([nearPrereqId, targetKcId]);
  });
});

describe('exercise domain — diagnostic lifecycle', () => {
  it('records diagnostic events in order, advances suspected to confirmed, and makes retries idempotent', async () => {
    const correctEvent = crypto.randomUUID();
    const firstWrongEvent = crypto.randomUUID();
    const secondWrongEvent = crypto.randomUUID();

    const correct = await recordExerciseEvidence(ctx(), {
      kc_id: targetKcId,
      purpose: 'diagnostic',
      correct: true,
      misconception_id: misconceptionId,
      event_id: correctEvent,
    });
    expect(correct.event.type).toBe('diagnostic_probe');
    expect(correct.misconception_lifecycle).toBeNull();

    // A malformed/pre-existing foreign lifecycle row must never affect this
    // learner's transition. The lookup is scoped by both user and
    // misconception, not just the catalog misconception id.
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await db.insert(userMisconceptions).values({
      id: crypto.randomUUID(),
      userId: otherUserId,
      misconceptionId,
      status: 'suspected',
      evidenceEventIds: [],
      suspectedAt: Date.now(),
      confirmedAt: null,
      correctingAt: null,
      internalizedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const first = await recordExerciseEvidence(ctx(), {
      kc_id: targetKcId,
      purpose: 'diagnostic',
      correct: false,
      misconception_id: misconceptionId,
      event_id: firstWrongEvent,
    });
    expect(first.misconception_lifecycle).toMatchObject({ status: 'suspected', evidenceEventIds: [firstWrongEvent] });

    const retry = await recordExerciseEvidence(ctx(), {
      kc_id: targetKcId,
      purpose: 'diagnostic',
      correct: false,
      misconception_id: misconceptionId,
      event_id: firstWrongEvent,
    });
    expect(retry.wasCreated).toBe(false);
    expect(retry.misconception_lifecycle).toBeNull();

    const second = await recordExerciseEvidence(ctx(), {
      kc_id: targetKcId,
      purpose: 'diagnostic',
      correct: false,
      misconception_id: misconceptionId,
      event_id: secondWrongEvent,
    });
    expect(second.misconception_lifecycle).toMatchObject({ status: 'confirmed', evidenceEventIds: [firstWrongEvent, secondWrongEvent] });

    const diagnosticEvents = await db
      .select()
      .from(events)
      .where(and(eq(events.userId, userId), eq(events.type, 'diagnostic_probe')))
      .orderBy(asc(events.createdAt));
    expect(diagnosticEvents.map((event) => event.id)).toEqual([correctEvent, firstWrongEvent, secondWrongEvent]);
    expect(diagnosticEvents.every((event) => event.isInstructional === false && event.isAssessment === true)).toBe(true);

    const lifecycleRows = await db
      .select()
      .from(userMisconceptions)
      .where(and(eq(userMisconceptions.userId, userId), eq(userMisconceptions.misconceptionId, misconceptionId)));
    expect(lifecycleRows).toHaveLength(1);
    expect(lifecycleRows[0]).toMatchObject({ status: 'confirmed', evidenceEventIds: [firstWrongEvent, secondWrongEvent] });
  });

  it('rejects cross-tenant and cross-KC diagnostic references before writing an event', async () => {
    const wrongKcExerciseId = await seedExercise(farPrereqId);
    const otherUserId = crypto.randomUUID();
    const otherCourseId = crypto.randomUUID();
    const otherBranchId = crypto.randomUUID();
    const otherKcId = crypto.randomUUID();
    const otherMisconceptionId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'OTHER 101', slug: `course-${otherCourseId}`, title: 'Other' });
    await db.insert(branches).values({ id: otherBranchId, courseId: otherCourseId, name: 'Other' });
    await db.insert(kcs).values({ id: otherKcId, courseId: otherCourseId, branchId: otherBranchId, name: 'Other KC' });
    await db.insert(misconceptions).values({
      id: otherMisconceptionId,
      kcId: otherKcId,
      slug: 'other-mistake',
      name: 'Other mistake',
      description: 'Wrong.',
      rootCause: 'Wrong.',
      diagnosticProbe: 'Wrong?',
      correction: 'Right.',
    });

    await expect(recordExerciseEvidence(ctx(), {
      kc_id: targetKcId,
      purpose: 'diagnostic',
      correct: false,
      misconception_id: otherMisconceptionId,
    })).rejects.toThrow('Misconception not found');
    await expect(recordExerciseEvidence(ctx(), {
      kc_id: crypto.randomUUID(),
      purpose: 'diagnostic',
      correct: false,
      misconception_id: misconceptionId,
    })).rejects.toThrow('KC not found');
    await expect(recordExerciseEvidence(ctx(), {
      kc_id: targetKcId,
      purpose: 'diagnostic',
      correct: false,
      exercise_id: wrongKcExerciseId,
      misconception_id: misconceptionId,
    })).rejects.toThrow('Exercise evidence must belong to the evidence KC');
    expect(await db.select().from(events).where(eq(events.userId, userId))).toHaveLength(0);
  });

  it('uses the canonical retrieval event for practice and assessment outcomes', async () => {
    await recordExerciseEvidence(ctx(), { kc_id: targetKcId, purpose: 'practice', correct: true, event_id: crypto.randomUUID() });
    await recordExerciseEvidence(ctx(), { kc_id: targetKcId, purpose: 'assessment', correct: false, event_id: crypto.randomUUID() });
    const recorded = await db.select().from(events).where(eq(events.userId, userId)).orderBy(asc(events.createdAt));
    expect(recorded.map((event) => event.type)).toEqual(['retrieval_practice', 'retrieval_practice']);
    expect(recorded.map((event) => (event.payload as { purpose: string }).purpose)).toEqual(['practice', 'assessment']);
  });
});

describe('exercise domain — generated bank persistence', () => {
  it('persists validated generated content for a thin bank without creating synthetic learner activity', async () => {
    const before = await selectExercises(ctx(), { kc_id: targetKcId, purpose: 'practice', count: 2 });
    expect(before.generation_needed_for_kc_ids).toEqual([targetKcId]);

    const created = await persistGeneratedExercises(ctx(), {
      kc_id: targetKcId,
      generator: 'openrouter:test-model',
      request_id: crypto.randomUUID(),
      items: [{
        kind: 'mcq',
        difficulty: 2,
        prompt: 'Generated prompt?',
        details: { options: ['A', 'B', 'C'], correct_index: 1, explanation: 'Generated explanation.' },
      }],
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kcId: targetKcId, origin: 'generated', source: 'generated:openrouter:test-model' });

    const persisted = await db.select().from(exercises).where(eq(exercises.id, created[0]!.id));
    expect(persisted[0]).toMatchObject({ origin: 'generated', prompt: 'Generated prompt?' });
    // Generated rows are the spec's content-state exception to the event log:
    // no learner performed an action merely because the bank was replenished.
    expect(await db.select().from(events).where(eq(events.userId, userId))).toHaveLength(0);

    const retry = await persistGeneratedExercises(ctx(), {
      kc_id: targetKcId,
      generator: 'openrouter:test-model',
      request_id: created[0]!.slug.slice('generated-'.length).replace(/-0$/, ''),
      items: [{
        kind: 'mcq',
        difficulty: 2,
        prompt: 'Generated prompt?',
        details: { options: ['A', 'B', 'C'], correct_index: 1, explanation: 'Generated explanation.' },
      }],
    });
    expect(retry.map((exercise) => exercise.id)).toEqual(created.map((exercise) => exercise.id));
    expect(await db.select().from(exercises).where(eq(exercises.kcId, targetKcId))).toHaveLength(1);

    const after = await selectExercises(ctx(), { kc_id: targetKcId, purpose: 'practice', count: 1 });
    expect(after.exercises[0]).toMatchObject({ id: created[0]!.id, origin: 'generated' });
    expect(after.generation_needed_for_kc_ids).toEqual([]);
  });

  it('rejects malformed generated items and cross-tenant target KCs without writes', async () => {
    await expect(persistGeneratedExercises(ctx(), {
      kc_id: targetKcId,
      generator: 'test',
      items: [{ kind: 'mcq', difficulty: 2, prompt: 'Bad?', details: { options: ['A', 'B', 'C'], correct_index: 3, explanation: 'Bad.' } }],
    })).rejects.toThrow('correct_index');

    const otherUserId = crypto.randomUUID();
    const otherCourseId = crypto.randomUUID();
    const otherBranchId = crypto.randomUUID();
    const otherKcId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'OTHER 102', slug: `course-${otherCourseId}`, title: 'Other' });
    await db.insert(branches).values({ id: otherBranchId, courseId: otherCourseId, name: 'Other' });
    await db.insert(kcs).values({ id: otherKcId, courseId: otherCourseId, branchId: otherBranchId, name: 'Other KC' });
    await expect(persistGeneratedExercises(ctx(), {
      kc_id: otherKcId,
      generator: 'test',
      items: [{ kind: 'worked', difficulty: 2, prompt: 'Worked?', details: { solution: 'Solution.' } }],
    })).rejects.toThrow('KC not found');
    expect(await db.select().from(exercises).where(eq(exercises.kcId, targetKcId))).toHaveLength(0);
  });
});
