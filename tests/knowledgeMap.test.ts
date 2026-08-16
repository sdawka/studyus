import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, kcEdges, kcs, misconceptions, scaffolds, users } from '../src/db/schema';
import { getKcGraph, listKcMisconceptions, listKcScaffolds } from '../src/lib/services/knowledgeMap';
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
    mastery: overrides.mastery ?? 0,
    status: overrides.status ?? 'not-started',
  });
  return id;
}

async function edge(kcId: string, prereqKcId: string) {
  await db.insert(kcEdges).values({ id: crypto.randomUUID(), kcId, prereqKcId });
}

describe('getKcGraph', () => {
  it('traverses a linear chain, computing BFS depth and the ready rule per node', async () => {
    // target -> readyPrereq (depth 1, mastery 60/review -> ready) -> notReadyPrereq (depth 2, mastery 10/learning -> not ready)
    const targetId = await makeKc({ name: 'Bernoulli equation', slug: 'bernoulli-equation' });
    const readyId = await makeKc({ name: 'Dimensional analysis', slug: 'dimensional-analysis', mastery: 60, status: 'review' });
    const notReadyId = await makeKc({ name: 'Unit conversion', slug: 'unit-conversion', mastery: 10, status: 'learning' });
    await edge(targetId, readyId);
    await edge(readyId, notReadyId);

    const graph = await getKcGraph(db, userId, targetId);

    expect(graph.kc).toMatchObject({ id: targetId, name: 'Bernoulli equation', kc_type: 'concept' });
    expect(graph.warnings).toEqual([]);
    expect(graph.prereqs).toHaveLength(2);

    const ready = graph.prereqs.find((p) => p.kc_id === readyId)!;
    expect(ready.depth).toBe(1);
    expect(ready.ready).toBe(true);
    expect(ready.prereq_kc_ids).toEqual([notReadyId]);

    const notReady = graph.prereqs.find((p) => p.kc_id === notReadyId)!;
    expect(notReady.depth).toBe(2);
    expect(notReady.ready).toBe(false);
    expect(notReady.prereq_kc_ids).toEqual([]);
  });

  it('applies the ready rule exactly (status !== not-started && mastery >= 40), not requiring mastered', async () => {
    const targetId = await makeKc({ name: 'Target' });
    // Below threshold despite non-not-started status.
    const belowThreshold = await makeKc({ name: 'Below', mastery: 39, status: 'learning' });
    // At threshold, review status (not mastered) -> still ready.
    const atThreshold = await makeKc({ name: 'At', mastery: 40, status: 'review' });
    // not-started with high mastery cache left over is still not ready (defensive; shouldn't occur in practice).
    const notStarted = await makeKc({ name: 'NotStarted', mastery: 90, status: 'not-started' });
    await edge(targetId, belowThreshold);
    await edge(targetId, atThreshold);
    await edge(targetId, notStarted);

    const graph = await getKcGraph(db, userId, targetId);
    const byId = new Map(graph.prereqs.map((p) => [p.kc_id, p]));
    expect(byId.get(belowThreshold)!.ready).toBe(false);
    expect(byId.get(atThreshold)!.ready).toBe(true);
    expect(byId.get(notStarted)!.ready).toBe(false);
  });

  it('handles a DAG diamond without a cycle warning, keeping the shortest depth', async () => {
    // target -> A, target -> B; A -> C, B -> C (C reachable via two paths, no back-edge)
    const targetId = await makeKc({ name: 'Target' });
    const aId = await makeKc({ name: 'A' });
    const bId = await makeKc({ name: 'B' });
    const cId = await makeKc({ name: 'C' });
    await edge(targetId, aId);
    await edge(targetId, bId);
    await edge(aId, cId);
    await edge(bId, cId);

    const graph = await getKcGraph(db, userId, targetId);
    expect(graph.warnings).toEqual([]);
    expect(graph.prereqs.filter((p) => p.kc_id === cId)).toHaveLength(1);
    expect(graph.prereqs.find((p) => p.kc_id === cId)!.depth).toBe(2);
  });

  it('is cycle-safe (terminates) and reports a defensively-detected cycle in warnings', async () => {
    // target -> A -> B -> A (back-edge)
    const targetId = await makeKc({ name: 'Target' });
    const aId = await makeKc({ name: 'A' });
    const bId = await makeKc({ name: 'B' });
    await edge(targetId, aId);
    await edge(aId, bId);
    await edge(bId, aId);

    const graph = await getKcGraph(db, userId, targetId);
    expect(graph.prereqs.map((p) => p.kc_id).sort()).toEqual([aId, bId].sort());
    expect(graph.warnings.some((w) => /cycle/i.test(w))).toBe(true);
  });

  it('returns an empty prereqs array with no warnings for a leaf KC', async () => {
    const targetId = await makeKc({ name: 'Leaf' });
    const graph = await getKcGraph(db, userId, targetId);
    expect(graph.prereqs).toEqual([]);
    expect(graph.warnings).toEqual([]);
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

    await expect(getKcGraph(db, userId, otherKcId)).rejects.toThrow(NotFoundError);
  });
});

describe('listKcMisconceptions', () => {
  it('returns seeded-shape misconception rows for the KC, ownership-checked', async () => {
    const kcId = await makeKc({ name: 'Bernoulli equation' });
    await db.insert(misconceptions).values([
      {
        id: crypto.randomUUID(),
        kcId,
        slug: 'high-speed-always-low-pressure',
        name: 'Higher velocity always means lower pressure',
        description: 'Velocity alone is believed to determine pressure everywhere.',
        rootCause: 'Overgeneralized from a single worked example.',
        diagnosticProbe: 'What condition does Bernoulli require to hold between two points?',
        correction: "Bernoulli's equation applies along a streamline for steady, incompressible, inviscid flow.",
      },
      {
        id: crypto.randomUUID(),
        kcId,
        slug: 'bernoulli-between-any-two-points',
        name: 'Bernoulli relates any two points in a flow',
        description: 'Assumed to hold between any two arbitrary points, moving or not.',
        rootCause: 'Missing the streamline/steady-flow precondition.',
        diagnosticProbe: 'Are the two points on the same streamline?',
        correction: 'Bernoulli only relates points on the same streamline in steady flow.',
      },
    ]);

    const rows = await listKcMisconceptions(db, userId, kcId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.slug)).toContain('high-speed-always-low-pressure');
  });

  it('404s (NotFoundError) on a KC owned by another user', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    const otherCourseId = crypto.randomUUID();
    await db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'X 1', slug: `other-${otherCourseId}`, title: 'Other' });
    const otherBranchId = crypto.randomUUID();
    await db.insert(branches).values({ id: otherBranchId, courseId: otherCourseId, name: 'B' });
    const otherKcId = crypto.randomUUID();
    await db.insert(kcs).values({ id: otherKcId, branchId: otherBranchId, courseId: otherCourseId, name: 'Other', kcType: 'concept' });

    await expect(listKcMisconceptions(db, userId, otherKcId)).rejects.toThrow(NotFoundError);
  });
});

describe('listKcScaffolds', () => {
  it('orders by sort_order and filters by inclusive max_level and by kind', async () => {
    const kcId = await makeKc({ name: 'Bernoulli equation' });
    await db.insert(scaffolds).values([
      { id: crypto.randomUUID(), kcId, kind: 'retrieval_prompt', level: 1, title: 'Recall prompt', body: 'b', sortOrder: 2 },
      { id: crypto.randomUUID(), kcId, kind: 'worked_example', level: 1, title: 'Worked example (fading 1/3)', body: 'b', sortOrder: 1 },
      { id: crypto.randomUUID(), kcId, kind: 'derivation_walkthrough', level: 3, title: 'Full derivation', body: 'b', sortOrder: 3 },
    ]);

    const all = await listKcScaffolds(db, userId, kcId);
    expect(all.map((s) => s.title)).toEqual(['Worked example (fading 1/3)', 'Recall prompt', 'Full derivation']);

    const upToLevel1 = await listKcScaffolds(db, userId, kcId, { maxLevel: 1 });
    expect(upToLevel1.map((s) => s.title)).toEqual(['Worked example (fading 1/3)', 'Recall prompt']);

    const byKind = await listKcScaffolds(db, userId, kcId, { kind: 'derivation_walkthrough' });
    expect(byKind.map((s) => s.title)).toEqual(['Full derivation']);
  });

  it('404s (NotFoundError) on a KC owned by another user', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    const otherCourseId = crypto.randomUUID();
    await db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'X 1', slug: `other-${otherCourseId}`, title: 'Other' });
    const otherBranchId = crypto.randomUUID();
    await db.insert(branches).values({ id: otherBranchId, courseId: otherCourseId, name: 'B' });
    const otherKcId = crypto.randomUUID();
    await db.insert(kcs).values({ id: otherKcId, branchId: otherBranchId, courseId: otherCourseId, name: 'Other', kcType: 'concept' });

    await expect(listKcScaffolds(db, userId, otherKcId)).rejects.toThrow(NotFoundError);
  });
});
