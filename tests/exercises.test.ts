import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, exercises, kcs, users } from '../src/db/schema';
import { listCourseMcqBank, listKcExercises } from '../src/lib/services/exercises';
import { NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let branchId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  branchId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'CHEE 310', slug: `chee-310-${courseId}`, title: 'Fluid Mechanics' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Dimensional Analysis' });
});

async function makeKc(overrides: Partial<typeof kcs.$inferInsert> = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  await db.insert(kcs).values({
    id,
    branchId,
    courseId,
    name: overrides.name ?? 'KC',
    kcType: overrides.kcType ?? 'concept',
    slug: overrides.slug ?? null,
  });
  return id;
}

describe('listKcExercises', () => {
  it('orders by sort_order and filters by kind', async () => {
    const kcId = await makeKc({ name: 'Bernoulli equation' });
    await db.insert(exercises).values([
      {
        id: crypto.randomUUID(),
        kcId,
        slug: 'mcq-one',
        kind: 'mcq',
        prompt: 'p1',
        source: 's',
        sortOrder: 2,
        details: { options: ['a', 'b', 'c'], correct_index: 0, explanation: 'e' },
      },
      {
        id: crypto.randomUUID(),
        kcId,
        slug: 'worked-one',
        kind: 'worked',
        prompt: 'p2',
        source: 's',
        sortOrder: 1,
        details: { solution: 'full solution' },
      },
      {
        id: crypto.randomUUID(),
        kcId,
        slug: 'numeric-one',
        kind: 'numeric',
        prompt: 'p3',
        source: 's',
        sortOrder: 3,
        details: { answer: { value: 1, unit: 'Pa', tolerance_pct: 2 }, solution: 'work' },
      },
    ]);

    const all = await listKcExercises(db, userId, kcId);
    expect(all.map((e) => e.slug)).toEqual(['worked-one', 'mcq-one', 'numeric-one']);

    const mcqOnly = await listKcExercises(db, userId, kcId, { kind: 'mcq' });
    expect(mcqOnly.map((e) => e.slug)).toEqual(['mcq-one']);
  });

  it('strips answers by default: mcq keeps only options, numeric keeps only unit, worked keeps solution', async () => {
    const kcId = await makeKc();
    await db.insert(exercises).values([
      {
        id: crypto.randomUUID(),
        kcId,
        slug: 'mcq-one',
        kind: 'mcq',
        prompt: 'p1',
        source: 's',
        details: { options: ['a', 'b', 'c'], correct_index: 1, explanation: 'secret' },
      },
      {
        id: crypto.randomUUID(),
        kcId,
        slug: 'numeric-one',
        kind: 'numeric',
        prompt: 'p2',
        source: 's',
        details: { answer: { value: 42, unit: 'Pa', tolerance_pct: 2 }, solution: 'secret math' },
      },
      {
        id: crypto.randomUUID(),
        kcId,
        slug: 'worked-one',
        kind: 'worked',
        prompt: 'p3',
        source: 's',
        details: { solution: 'the whole point' },
      },
    ]);

    const rows = await listKcExercises(db, userId, kcId);
    const bySlug = new Map(rows.map((r) => [r.slug, r]));

    const mcq = bySlug.get('mcq-one')!;
    expect(mcq.details).toEqual({ options: ['a', 'b', 'c'] });
    expect(JSON.stringify(mcq.details)).not.toContain('secret');

    const numeric = bySlug.get('numeric-one')!;
    expect(numeric.details).toEqual({ unit: 'Pa' });
    expect(JSON.stringify(numeric.details)).not.toContain('42');
    expect(JSON.stringify(numeric.details)).not.toContain('secret math');

    const worked = bySlug.get('worked-one')!;
    expect(worked.details).toEqual({ solution: 'the whole point' });
  });

  it('withAnswers: true returns the full details payload', async () => {
    const kcId = await makeKc();
    const details = { options: ['a', 'b', 'c'], correct_index: 2, explanation: 'why' };
    await db.insert(exercises).values({
      id: crypto.randomUUID(),
      kcId,
      slug: 'mcq-one',
      kind: 'mcq',
      prompt: 'p1',
      source: 's',
      details,
    });

    const rows = await listKcExercises(db, userId, kcId, { withAnswers: true });
    expect(rows[0].details).toEqual(details);
  });

  it('404s (NotFoundError) on a KC owned by another user', async () => {
    const otherUserId = crypto.randomUUID();
    const otherCourseId = crypto.randomUUID();
    const otherBranchId = crypto.randomUUID();
    const otherKcId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'X 1', slug: `other-${otherCourseId}`, title: 'Other' });
    await db.insert(branches).values({ id: otherBranchId, courseId: otherCourseId, name: 'B' });
    await db.insert(kcs).values({ id: otherKcId, branchId: otherBranchId, courseId: otherCourseId, name: 'Other', kcType: 'concept' });

    await expect(listKcExercises(db, userId, otherKcId)).rejects.toThrow(NotFoundError);
  });
});

describe('listCourseMcqBank', () => {
  it('returns only mcq exercises across the course, with full details', async () => {
    const kcA = await makeKc({ name: 'KC A' });
    const kcB = await makeKc({ name: 'KC B' });
    await db.insert(exercises).values([
      {
        id: crypto.randomUUID(),
        kcId: kcA,
        slug: 'mcq-a',
        kind: 'mcq',
        prompt: 'pa',
        source: 's',
        details: { options: ['a', 'b', 'c'], correct_index: 0, explanation: 'e' },
      },
      {
        id: crypto.randomUUID(),
        kcId: kcB,
        slug: 'mcq-b',
        kind: 'mcq',
        prompt: 'pb',
        source: 's',
        details: { options: ['x', 'y', 'z'], correct_index: 1, explanation: 'e2' },
      },
      {
        id: crypto.randomUUID(),
        kcId: kcA,
        slug: 'worked-a',
        kind: 'worked',
        prompt: 'pc',
        source: 's',
        details: { solution: 'sol' },
      },
    ]);

    const bank = await listCourseMcqBank(db, userId, courseId);
    expect(bank.map((e) => e.slug).sort()).toEqual(['mcq-a', 'mcq-b']);
    const mcqA = bank.find((e) => e.slug === 'mcq-a')!;
    expect(mcqA.details).toEqual({ options: ['a', 'b', 'c'], correct_index: 0, explanation: 'e' });
  });

  it('404s (NotFoundError) on a course owned by another user', async () => {
    const otherUserId = crypto.randomUUID();
    const otherCourseId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'X 1', slug: `other-${otherCourseId}`, title: 'Other' });

    await expect(listCourseMcqBank(db, userId, otherCourseId)).rejects.toThrow(NotFoundError);
  });
});
