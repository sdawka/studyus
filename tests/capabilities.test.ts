import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import {
  branches,
  capabilities,
  capabilityKcs,
  courses,
  events,
  kcs,
  tutorConversations,
  userCorrections,
  users,
} from '../src/db/schema';
import { getMetaSkills, listCapabilities } from '../src/lib/services/capabilities';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let branchId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  branchId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'CHEE 314', slug: `chee-314-${courseId}`, title: 'Fluid Mechanics' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
});

async function makeKc(overrides: Partial<typeof kcs.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db.insert(kcs).values({
    id,
    branchId,
    courseId,
    name: 'Bernoulli equation',
    kcType: 'principle',
    mastery: 0,
    status: 'not-started',
    ...overrides,
  });
  return id;
}

describe('listCapabilities', () => {
  it('returns an empty array when the user has no capabilities', async () => {
    expect(await listCapabilities(db, userId)).toEqual([]);
  });

  it('folds member KCs into derived mastery/coverage/status, joined with member name/course_id/weight', async () => {
    const kcA = await makeKc({ name: 'Bernoulli equation', mastery: 100, status: 'mastered' });
    const kcB = await makeKc({ name: 'Reynolds number', mastery: 50, status: 'review' });

    const capId = crypto.randomUUID();
    await db.insert(capabilities).values({ id: capId, userId, slug: 'transport-intuition', name: 'Transport intuition', source: 'seed' });
    await db.insert(capabilityKcs).values([
      { id: crypto.randomUUID(), capabilityId: capId, kcId: kcA, weight: 1 },
      { id: crypto.randomUUID(), capabilityId: capId, kcId: kcB, weight: 1 },
    ]);

    const rows = await listCapabilities(db, userId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.slug).toBe('transport-intuition');
    expect(row.source).toBe('seed');
    expect(row.mastery).toBe(75); // (100 + 50) / 2
    expect(row.coverage).toBe(1);
    expect(row.status).toBe('review'); // 75 >= 40 but < 80
    expect(row.members).toHaveLength(2);
    const memberA = row.members.find((m) => m.kcId === kcA)!;
    expect(memberA).toMatchObject({ name: 'Bernoulli equation', courseId, mastery: 100, status: 'mastered', weight: 1 });
  });

  it('scopes capabilities to the requesting user', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await db.insert(capabilities).values({ id: crypto.randomUUID(), userId: otherUserId, slug: 'other', name: 'Other', source: 'seed' });

    expect(await listCapabilities(db, userId)).toEqual([]);
  });
});

describe('getMetaSkills', () => {
  const NOW = Date.UTC(2026, 0, 28);
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('returns all 3 catalog skills at zero with no activity', async () => {
    const result = await getMetaSkills(db, userId, NOW);
    expect(result.map((r) => r.key).sort()).toEqual(['error_analysis', 'retrieval_practice', 'self_explanation'].sort());
    for (const skill of result) expect(skill.count_28d).toBe(0);
  });

  it('counts retrieval_practice/quiz_taken/self_assessment events as retrieval_practice signals', async () => {
    await db.insert(events).values([
      { id: crypto.randomUUID(), userId, ts: NOW - 1 * DAY_MS, type: 'retrieval_practice', isInstructional: true, isAssessment: true, source: 'manual' },
      { id: crypto.randomUUID(), userId, ts: NOW - 2 * DAY_MS, type: 'quiz_taken', isInstructional: false, isAssessment: true, source: 'manual' },
      { id: crypto.randomUUID(), userId, ts: NOW - 3 * DAY_MS, type: 'self_assessment', isInstructional: false, isAssessment: true, source: 'manual' },
      // not a retrieval type -> shouldn't count
      { id: crypto.randomUUID(), userId, ts: NOW - 1 * DAY_MS, type: 'lecture_attended', isInstructional: true, isAssessment: false, source: 'manual' },
    ]);

    const result = await getMetaSkills(db, userId, NOW);
    expect(result.find((r) => r.key === 'retrieval_practice')!.count_28d).toBe(3);
  });

  it('counts self_explain tutor conversations and taught_someone events as self_explanation signals', async () => {
    const kcId = await makeKc();
    await db.insert(tutorConversations).values({ id: crypto.randomUUID(), userId, kcId, mode: 'self_explain', createdAt: NOW - 1 * DAY_MS });
    await db.insert(tutorConversations).values({ id: crypto.randomUUID(), userId, kcId, mode: 'recall', createdAt: NOW - 1 * DAY_MS });
    await db.insert(events).values({
      id: crypto.randomUUID(),
      userId,
      ts: NOW - 2 * DAY_MS,
      type: 'taught_someone',
      isInstructional: true,
      isAssessment: false,
      source: 'manual',
    });

    const result = await getMetaSkills(db, userId, NOW);
    expect(result.find((r) => r.key === 'self_explanation')!.count_28d).toBe(2);
  });

  it('counts accepted corrections as error_analysis signals', async () => {
    await db.insert(userCorrections).values({
      id: crypto.randomUUID(),
      userId,
      correction: 'Units must match before comparing.',
      status: 'active',
      acceptedAt: NOW - 1 * DAY_MS,
    });

    const result = await getMetaSkills(db, userId, NOW);
    expect(result.find((r) => r.key === 'error_analysis')!.count_28d).toBe(1);
  });

  it('counts a failed-then-later-passed assessment pair on the same KC as one error_analysis signal', async () => {
    const kcId = await makeKc();
    await db.insert(events).values([
      {
        id: crypto.randomUUID(),
        userId,
        kcId,
        ts: NOW - 10 * DAY_MS,
        type: 'quiz_taken',
        isInstructional: false,
        isAssessment: true,
        source: 'manual',
        payload: { correct: false },
      },
      {
        id: crypto.randomUUID(),
        userId,
        kcId,
        ts: NOW - 5 * DAY_MS,
        type: 'quiz_taken',
        isInstructional: false,
        isAssessment: true,
        source: 'manual',
        payload: { correct: true },
      },
    ]);

    const result = await getMetaSkills(db, userId, NOW);
    expect(result.find((r) => r.key === 'error_analysis')!.count_28d).toBe(1);
  });

  it('does not count a pass with no prior fail, or a fail alone', async () => {
    const kcId = await makeKc();
    await db.insert(events).values([
      {
        id: crypto.randomUUID(),
        userId,
        kcId,
        ts: NOW - 5 * DAY_MS,
        type: 'quiz_taken',
        isInstructional: false,
        isAssessment: true,
        source: 'manual',
        payload: { correct: true },
      },
    ]);

    const result = await getMetaSkills(db, userId, NOW);
    expect(result.find((r) => r.key === 'error_analysis')!.count_28d).toBe(0);
  });
});
