import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, events, exercises, kcs, users } from '../src/db/schema';
import { ExerciseAttemptMismatchError, gradeExerciseAttempt } from '../src/lib/flows/exercise_attempt';
import { NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let branchId: string;
let kcId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  branchId = crypto.randomUUID();
  kcId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'CHEE 310', slug: `chee-310-${courseId}`, title: 'Fluid Mechanics' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Dimensional Analysis' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Bernoulli equation', kcType: 'concept' });
});

async function makeExercise(overrides: Partial<typeof exercises.$inferInsert>) {
  const id = overrides.id ?? crypto.randomUUID();
  await db.insert(exercises).values({
    id,
    kcId,
    slug: overrides.slug ?? 'ex',
    kind: overrides.kind ?? 'numeric',
    prompt: overrides.prompt ?? 'Prompt',
    source: overrides.source ?? 'source',
    details: overrides.details ?? {},
  });
  return id;
}

describe('gradeExerciseAttempt — numeric', () => {
  it('grades within tolerance_pct as correct and returns the answer + solution', async () => {
    const exId = await makeExercise({
      kind: 'numeric',
      details: { answer: { value: 100, unit: 'kPa', tolerance_pct: 2 }, solution: 'Work: P = ...' },
    });

    const result = await gradeExerciseAttempt(db, userId, exId, { value: 101 });
    expect(result.correct).toBe(true);
    if (!('answer' in result)) throw new Error('expected a numeric grading result');
    expect(result.answer).toEqual({ value: 100, unit: 'kPa' });
    expect(result.solution).toBe('Work: P = ...');
  });

  it('grades outside tolerance_pct as incorrect', async () => {
    const exId = await makeExercise({
      kind: 'numeric',
      details: { answer: { value: 100, unit: 'kPa', tolerance_pct: 2 }, solution: 'Work' },
    });

    const result = await gradeExerciseAttempt(db, userId, exId, { value: 110 });
    expect(result.correct).toBe(false);
  });

  it('rejects a mcq-shaped attempt against a numeric exercise', async () => {
    const exId = await makeExercise({
      kind: 'numeric',
      details: { answer: { value: 100, unit: null, tolerance_pct: 2 }, solution: 'Work' },
    });

    await expect(gradeExerciseAttempt(db, userId, exId, { selected_index: 0 })).rejects.toThrow(ExerciseAttemptMismatchError);
  });
});

describe('gradeExerciseAttempt — mcq', () => {
  it('grades a correct selection and returns correct_index + explanation', async () => {
    const exId = await makeExercise({
      kind: 'mcq',
      details: { options: ['a', 'b', 'c'], correct_index: 1, explanation: 'b is right because...' },
    });

    const result = await gradeExerciseAttempt(db, userId, exId, { selected_index: 1 });
    expect(result.correct).toBe(true);
    if (!('correct_index' in result)) throw new Error('expected a mcq grading result');
    expect(result.correct_index).toBe(1);
    expect(result.explanation).toBe('b is right because...');
  });

  it('grades an incorrect selection', async () => {
    const exId = await makeExercise({
      kind: 'mcq',
      details: { options: ['a', 'b', 'c'], correct_index: 1, explanation: 'e' },
    });

    const result = await gradeExerciseAttempt(db, userId, exId, { selected_index: 0 });
    expect(result.correct).toBe(false);
  });

  it('rejects a numeric-shaped attempt against a mcq exercise', async () => {
    const exId = await makeExercise({
      kind: 'mcq',
      details: { options: ['a', 'b'], correct_index: 0, explanation: 'e' },
    });

    await expect(gradeExerciseAttempt(db, userId, exId, { value: 1 })).rejects.toThrow(ExerciseAttemptMismatchError);
  });
});

describe('gradeExerciseAttempt — worked', () => {
  it('has no gradeable attempt', async () => {
    const exId = await makeExercise({ kind: 'worked', details: { solution: 'Full walkthrough' } });

    await expect(gradeExerciseAttempt(db, userId, exId, { value: 1 })).rejects.toThrow(ExerciseAttemptMismatchError);
  });
});

describe('gradeExerciseAttempt — events + ownership', () => {
  it('records a retrieval_practice event on the exercise KC with source "tutor" and channel "exercise"', async () => {
    const exId = await makeExercise({
      kind: 'mcq',
      details: { options: ['a', 'b'], correct_index: 0, explanation: 'e' },
    });

    await gradeExerciseAttempt(db, userId, exId, { selected_index: 0 });

    const kcEvents = await db.select().from(events).where(eq(events.kcId, kcId));
    const graded = kcEvents.find((e) => e.type === 'retrieval_practice');
    expect(graded).toBeDefined();
    expect(graded?.source).toBe('tutor');
    expect(graded?.isInstructional).toBe(true);
    expect(graded?.isAssessment).toBe(true);
    expect(graded?.payload).toMatchObject({ correct: true, exercise_id: exId, channel: 'exercise' });
  });

  it('returns mastery_deltas for the graded KC', async () => {
    const exId = await makeExercise({
      kind: 'numeric',
      details: { answer: { value: 1, unit: null, tolerance_pct: 2 }, solution: 'Work' },
    });

    const result = await gradeExerciseAttempt(db, userId, exId, { value: 1 });
    expect(result.mastery_deltas).toHaveLength(1);
    expect(result.mastery_deltas[0]).toMatchObject({ kc_id: kcId });
  });

  it('404s on an exercise belonging to another user', async () => {
    const exId = await makeExercise({
      kind: 'numeric',
      details: { answer: { value: 1, unit: null, tolerance_pct: 2 }, solution: 'Work' },
    });
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });

    await expect(gradeExerciseAttempt(db, otherUserId, exId, { value: 1 })).rejects.toThrow(NotFoundError);
  });
});
