import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, events, kcEdges, kcs, users } from '../src/db/schema';
import { getCourseMap, updateCourseMap } from '../src/lib/services/courseMap';

const db = getDb(env.DB);
let userId: string;
let courseId: string;
let branchId: string;
let firstId: string;
let secondId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  branchId = crypto.randomUUID();
  firstId = crypto.randomUUID();
  secondId = crypto.randomUUID();
  await db.batch([
    db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'clerk-managed' }),
    db.insert(courses).values({ id: courseId, userId, code: 'MAP 101', slug: `map-${courseId}`, title: 'Map maintenance' }),
    db.insert(branches).values({ id: branchId, courseId, name: 'Foundations', sortOrder: 0 }),
    db.insert(kcs).values({ id: firstId, branchId, courseId, name: 'Foundation', kcType: 'concept', sortOrder: 0 }),
    db.insert(kcs).values({ id: secondId, branchId, courseId, name: 'Application', kcType: 'rule', sortOrder: 1 }),
    db.insert(kcEdges).values({ id: crypto.randomUUID(), kcId: secondId, prereqKcId: firstId, source: 'user' }),
  ]);
});

function savedBranches(map: Awaited<ReturnType<typeof getCourseMap>>) {
  return map.branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    sort_order: branch.sortOrder,
    archived: branch.archived,
    kcs: branch.kcs.map((kc) => ({
      id: kc.id,
      name: kc.name,
      kc_type: kc.kcType,
      description: kc.description,
      practice_notes: kc.practiceNotes,
      sort_order: kc.sortOrder,
      archived: kc.archived,
      prerequisite_kc_ids: kc.prerequisiteKcIds,
    })),
  }));
}

describe('course-map maintenance', () => {
  it('saves edits atomically and rejects a stale revision', async () => {
    const map = await getCourseMap(db, userId, courseId);
    const input = savedBranches(map);
    input[0].kcs[1].name = 'Applied model';
    const saved = await updateCourseMap(db, userId, courseId, { expected_revision: map.course.mapRevision, branches: input });
    expect(saved.course.mapRevision).toBe(map.course.mapRevision + 1);
    expect(saved.branches[0].kcs[1].name).toBe('Applied model');

    await expect(updateCourseMap(db, userId, courseId, { expected_revision: map.course.mapRevision, branches: input }))
      .rejects.toThrow('another tab');
  });

  it('prevents cycles and archiving an active prerequisite', async () => {
    const map = await getCourseMap(db, userId, courseId);
    const cyclic = savedBranches(map);
    cyclic[0].kcs[0].prerequisite_kc_ids = [secondId];
    await expect(updateCourseMap(db, userId, courseId, { expected_revision: map.course.mapRevision, branches: cyclic }))
      .rejects.toThrow('cycle');

    const archived = savedBranches(map);
    archived[0].kcs[0].archived = true;
    await expect(updateCourseMap(db, userId, courseId, { expected_revision: map.course.mapRevision, branches: archived }))
      .rejects.toThrow('dependent');
  });

  it('archives without deleting history and excludes the KC from active candidates', async () => {
    await db.insert(events).values({ id: crypto.randomUUID(), userId, ts: Date.now(), type: 'practice', kcId: secondId, courseId, source: 'manual' });
    const map = await getCourseMap(db, userId, courseId);
    const input = savedBranches(map);
    input[0].kcs[1].archived = true;
    input[0].kcs[1].prerequisite_kc_ids = [];
    const saved = await updateCourseMap(db, userId, courseId, { expected_revision: map.course.mapRevision, branches: input });

    expect(saved.branches[0].kcs.find((kc) => kc.id === secondId)?.archived).toBe(true);
    expect(saved.prerequisiteCandidates.some((candidate) => candidate.id === secondId)).toBe(false);
    expect(await db.select().from(events).where(eq(events.kcId, secondId))).toHaveLength(1);
    expect(await db.select().from(kcs).where(eq(kcs.id, secondId))).toHaveLength(1);
  });

  it('allows prerequisites from another owned course', async () => {
    const otherCourseId = crypto.randomUUID();
    const otherBranchId = crypto.randomUUID();
    const otherKcId = crypto.randomUUID();
    await db.batch([
      db.insert(courses).values({ id: otherCourseId, userId, code: 'OTHER', slug: `other-${otherCourseId}`, title: 'Other course' }),
      db.insert(branches).values({ id: otherBranchId, courseId: otherCourseId, name: 'Other', sortOrder: 0 }),
      db.insert(kcs).values({ id: otherKcId, branchId: otherBranchId, courseId: otherCourseId, name: 'Outside prerequisite', kcType: 'fact', sortOrder: 0 }),
    ]);
    const map = await getCourseMap(db, userId, courseId);
    const input = savedBranches(map);
    input[0].kcs[0].prerequisite_kc_ids = [otherKcId];
    const saved = await updateCourseMap(db, userId, courseId, { expected_revision: map.course.mapRevision, branches: input });
    expect(saved.branches[0].kcs[0].prerequisiteKcIds).toContain(otherKcId);
  });

  it('loads an owned graph larger than D1\'s bound-parameter limit', async () => {
    const extraIds = Array.from({ length: 105 }, () => crypto.randomUUID());
    const inserts = extraIds.map((id, index) =>
      db.insert(kcs).values({ id, branchId, courseId, name: `Large graph ${index}`, kcType: 'concept', sortOrder: index + 2 }),
    );
    for (let index = 0; index < inserts.length; index += 50) {
      const batch = inserts.slice(index, index + 50);
      await db.batch(batch as [typeof batch[number], ...typeof batch]);
    }
    await db.insert(kcEdges).values({ id: crypto.randomUUID(), kcId: extraIds[104], prereqKcId: extraIds[0], source: 'user' });

    const map = await getCourseMap(db, userId, courseId);
    expect(map.prerequisiteCandidates).toHaveLength(107);
    expect(map.branches[0].kcs.find((kc) => kc.id === extraIds[104])?.prerequisiteKcIds).toEqual([extraIds[0]]);
  });
});
