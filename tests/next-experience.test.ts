import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { selectNextExperience, type NextExperienceGraph } from '../src/lib/domain/nextExperience';
import type { KcState } from '../src/lib/domain/kcState';
import { getDb } from '../src/db/client';
import { branches, courses, experienceKcs, experiences, kcEdges, kcs, users } from '../src/db/schema';
import { getNextExperience } from '../src/lib/services/mastery';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 8, 12);

function state(overrides: Partial<KcState> = {}): KcState {
  return {
    masteryEstimate: 0, masteryStatus: 'not-started', confidence: 0, evidenceIds: [], lastUpdatedAt: null,
    hasTransferEvidence: false, hasRetentionEvidence: false, meetsMasteryRule: false,
    lastEvidenceSucceeded: null, lastExperienceId: null, activeMisconceptionIds: [], evidence: [], ...overrides,
  };
}

function graph(overrides: Partial<NextExperienceGraph> = {}): NextExperienceGraph {
  return {
    learnerId: 'learner',
    kcs: [{ id: 'kc', learnerId: 'learner', prerequisiteKcIds: [], masteryRule: {} }],
    experiences: [{ id: 'basic', learnerId: 'learner', targetKcIds: ['kc'], kind: 'exercise', sortOrder: 0 }],
    ...overrides,
  };
}

describe('selectNextExperience', () => {
  it('blocks a target until its prerequisite is met and selects prerequisite repair', () => {
    const input = graph({
      kcs: [
        { id: 'prereq', learnerId: 'learner', prerequisiteKcIds: [], masteryRule: {} },
        { id: 'target', learnerId: 'learner', prerequisiteKcIds: ['prereq'], masteryRule: {} },
      ],
      experiences: [
        { id: 'target-check', learnerId: 'learner', targetKcIds: ['target'], kind: 'exercise', sortOrder: 0 },
        { id: 'prereq-help', learnerId: 'learner', targetKcIds: ['prereq'], kind: 'scaffold', supportLevel: 1, sortOrder: 1 },
      ],
    });
    const choice = selectNextExperience(input, { prereq: state(), target: state() }, now);
    expect(choice.experienceId).toBe('prereq-help');
    expect(choice.reasons).toContain('prerequisite repair for target');
  });

  it('selects a due spaced retention review but does not immediately repeat a check', () => {
    const input = graph({ experiences: [
      { id: 'check', learnerId: 'learner', targetKcIds: ['kc'], kind: 'exercise', evidenceTags: [], sortOrder: 0 },
      { id: 'retention', learnerId: 'learner', targetKcIds: ['kc'], kind: 'exercise', evidenceTags: ['retention'], sortOrder: 1 },
    ] });
    const due = selectNextExperience(input, { kc: state({ evidenceIds: ['e1'], lastUpdatedAt: now - 2 * DAY, lastExperienceId: 'check' }) }, now);
    expect(due.experienceId).toBe('retention');
    expect(due.reasons).toContain('spaced review due for kc');

    const recent = selectNextExperience(input, { kc: state({ evidenceIds: ['e1'], lastUpdatedAt: now - 60_000, lastExperienceId: 'retention' }) }, now);
    expect(recent.experienceId).toBe('check');
    expect(recent.reasons).toContain('avoids immediate repetition');
  });

  it('fades support after success', () => {
    const input = graph({ experiences: [
      { id: 'supported', learnerId: 'learner', targetKcIds: ['kc'], kind: 'scaffold', supportLevel: 1, sortOrder: 0 },
      { id: 'faded', learnerId: 'learner', targetKcIds: ['kc'], kind: 'scaffold', supportLevel: 2, sortOrder: 1 },
    ] });
    const choice = selectNextExperience(input, { kc: state({ lastEvidenceSucceeded: true, lastExperienceId: 'supported' }) }, now);
    expect(choice.experienceId).toBe('faded');
    expect(choice.reasons).toContain('fades support after success on kc');
  });

  it('returns to stronger instructional support after weak evidence', () => {
    const input = graph({ experiences: [
      { id: 'practice', learnerId: 'learner', targetKcIds: ['kc'], kind: 'exercise', sortOrder: 0 },
      { id: 'support', learnerId: 'learner', targetKcIds: ['kc'], kind: 'scaffold', supportLevel: 1, sortOrder: 1 },
    ] });
    const choice = selectNextExperience(input, { kc: state({ evidenceIds: ['e1'], lastEvidenceSucceeded: false }) }, now);
    expect(choice).toEqual({ experienceId: 'support', reasons: ['adds support after weak evidence for kc'] });
  });

  it('prioritizes a matching diagnostic repair after misconception evidence', () => {
    const input = graph({ experiences: [
      { id: 'ordinary', learnerId: 'learner', targetKcIds: ['kc'], kind: 'exercise', sortOrder: 0 },
      { id: 'repair', learnerId: 'learner', targetKcIds: ['kc'], kind: 'scaffold', diagnosticMisconceptionIds: ['m1'], sortOrder: 1 },
    ] });
    const choice = selectNextExperience(input, { kc: state({ activeMisconceptionIds: ['m1'] }) }, now);
    expect(choice.experienceId).toBe('repair');
    expect(choice.reasons).toContain('repairs misconception m1');
  });

  it('reserves transfer until a later encounter and then selects it when required', () => {
    const input = graph({
      kcs: [{ id: 'kc', learnerId: 'learner', prerequisiteKcIds: [], masteryRule: { threshold: 0.8, requires_transfer: true } }],
      experiences: [
        { id: 'ordinary', learnerId: 'learner', targetKcIds: ['kc'], kind: 'exercise', sortOrder: 0 },
        { id: 'transfer', learnerId: 'learner', targetKcIds: ['kc'], kind: 'project', evidenceTags: ['transfer'], sortOrder: 1 },
      ],
    });
    const first = selectNextExperience(input, { kc: state({ masteryEstimate: 90 }) }, now);
    expect(first.experienceId).toBe('ordinary');
    const later = selectNextExperience(input, { kc: state({ masteryEstimate: 90, evidenceIds: ['e1'], lastUpdatedAt: now - 2 * DAY }) }, now);
    expect(later.experienceId).toBe('transfer');
    expect(later.reasons).toContain('transfer evidence required for kc');
  });

  it('rejects cross-learner graph entries and breaks equal ties by sort order then ID', () => {
    const tied = graph({ experiences: [
      { id: 'z', learnerId: 'learner', targetKcIds: ['kc'], kind: 'exercise', sortOrder: 1 },
      { id: 'b', learnerId: 'learner', targetKcIds: ['kc'], kind: 'exercise', sortOrder: 0 },
      { id: 'a', learnerId: 'learner', targetKcIds: ['kc'], kind: 'exercise', sortOrder: 0 },
    ] });
    expect(selectNextExperience(tied, { kc: state() }, now)).toMatchObject({
      experienceId: 'a', reasons: ['ready unmet KC kc', 'deterministic tie-break'],
    });
    expect(() => selectNextExperience(graph({ experiences: [
      { id: 'foreign', learnerId: 'other', targetKcIds: ['kc'], kind: 'exercise' },
    ] }), { kc: state() }, now)).toThrow('Cross-learner experience target');
  });

  it('does not let an already-satisfied earlier experience outrank an unmet KC', () => {
    const input = graph({
      kcs: [
        { id: 'mastered-a', learnerId: 'learner', prerequisiteKcIds: [], masteryRule: {} },
        { id: 'unmet-b', learnerId: 'learner', prerequisiteKcIds: [], masteryRule: {} },
      ],
      experiences: [
        { id: 'mastered-first', learnerId: 'learner', targetKcIds: ['mastered-a'], kind: 'exercise', sortOrder: 0 },
        { id: 'unmet-second', learnerId: 'learner', targetKcIds: ['unmet-b'], kind: 'exercise', sortOrder: 1 },
      ],
    });

    expect(selectNextExperience(input, {
      'mastered-a': state({ meetsMasteryRule: true, masteryEstimate: 100 }),
      'unmet-b': state(),
    }, now)).toEqual({ experienceId: 'unmet-second', reasons: ['ready unmet KC unmet-b'] });
  });
});

describe('getNextExperience', () => {
  it('loads learner state with a constant number of database queries as KC count grows', async () => {
    const realDb = getDb(env.DB);
    const learnerId = crypto.randomUUID();
    const courseId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    await realDb.insert(users).values({ id: learnerId, email: `${learnerId}@test.local`, passwordHash: 'x' });
    await realDb.insert(courses).values({ id: courseId, userId: learnerId, code: 'BATCH', slug: `batch-${courseId}`, title: 'Batch' });
    await realDb.insert(branches).values({ id: branchId, courseId, name: 'General' });
    const kcIds = Array.from({ length: 120 }, () => crypto.randomUUID());
    for (const [index, id] of kcIds.entries()) {
      await realDb.insert(kcs).values({ id, branchId, courseId, name: `KC ${index}` });
    }
    const experienceId = crypto.randomUUID();
    await realDb.insert(experiences).values({
      id: experienceId, courseId, kind: 'exercise', intendedProcesses: ['memory_fluency'],
      content: { schema_version: 1, kind: 'worked', prompt: 'Try', solution: 'Answer' }, evidenceResponseType: 'constructed_response',
    });
    for (const [sortOrder, kcId] of kcIds.entries()) {
      await realDb.insert(experienceKcs).values({ experienceId, kcId, courseId, isEvidenceTarget: true, sortOrder });
    }
    let selects = 0;
    const measuredDb = new Proxy(realDb, { get(target, property) {
      if (property === 'select') return (...args: Parameters<typeof realDb.select>) => { selects += 1; return target.select(...args); };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    await getNextExperience(measuredDb, learnerId, now);
    expect(selects).toBeLessThanOrEqual(12);
  });
  it('assembles learner-owned graph/state and resolves the pure selector result', async () => {
    const db = getDb(env.DB);
    const learnerId = crypto.randomUUID();
    const courseId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const kcId = crypto.randomUUID();
    const experienceId = crypto.randomUUID();
    await db.insert(users).values({ id: learnerId, email: `${learnerId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: courseId, userId: learnerId, code: 'NEXT', slug: `next-${courseId}`, title: 'Next' });
    await db.insert(branches).values({ id: branchId, courseId, name: 'General' });
    await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'KC', masteryRule: { minimum_evidence: 1 } });
    await db.insert(experiences).values({
      id: experienceId, courseId, kind: 'exercise', intendedProcesses: ['memory_fluency'],
      content: { schema_version: 1, kind: 'worked', prompt: 'Try', solution: 'Answer' }, evidenceResponseType: 'constructed_response',
    });
    await db.insert(experienceKcs).values({ experienceId, kcId, courseId, isEvidenceTarget: true });

    const result = await getNextExperience(db, learnerId, now);
    expect(result.experience.id).toBe(experienceId);
    expect(result.reasons).toEqual([`ready unmet KC ${kcId}`]);
  });

  it('ignores archived graph content while preserving context-only KC targets', async () => {
    const db = getDb(env.DB);
    const learnerId = crypto.randomUUID();
    const courseId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const kcId = crypto.randomUUID();
    const contextKcId = crypto.randomUUID();
    const missingPrereqId = crypto.randomUUID();
    const archivedKcId = crypto.randomUUID();
    const experienceId = crypto.randomUUID();
    const archivedBranchId = crypto.randomUUID();
    const archivedBranchKcId = crypto.randomUUID();
    const archivedCourseId = crypto.randomUUID();
    const archivedCourseBranchId = crypto.randomUUID();
    const archivedCourseKcId = crypto.randomUUID();
    const archivedExperienceId = crypto.randomUUID();
    await db.insert(users).values({ id: learnerId, email: `${learnerId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: courseId, userId: learnerId, code: 'ACTIVE', slug: `active-${courseId}`, title: 'Active' });
    await db.insert(branches).values({ id: branchId, courseId, name: 'Active branch' });
    await db.insert(branches).values({ id: archivedBranchId, courseId, name: 'Archived branch', archivedAt: now });
    await db.insert(kcs).values([
      { id: kcId, branchId, courseId, name: 'Active KC' },
      { id: contextKcId, branchId, courseId, name: 'Context KC' },
      { id: missingPrereqId, branchId, courseId, name: 'Missing prerequisite' },
      { id: archivedKcId, branchId, courseId, name: 'Archived KC', archivedAt: now },
      { id: archivedBranchKcId, branchId: archivedBranchId, courseId, name: 'KC on archived branch' },
    ]);
    await db.insert(experiences).values({
      id: experienceId, courseId, kind: 'exercise', intendedProcesses: ['memory_fluency'],
      content: { schema_version: 1, kind: 'worked', prompt: 'Try', solution: 'Answer' }, evidenceResponseType: 'constructed_response',
    });
    await db.insert(experienceKcs).values([
      { experienceId, kcId, courseId, isEvidenceTarget: true, sortOrder: 1 },
      { experienceId, kcId: contextKcId, courseId, isEvidenceTarget: false, sortOrder: 0 },
    ]);
    await db.insert(courses).values({
      id: archivedCourseId, userId: learnerId, code: 'OLD', slug: `old-${archivedCourseId}`, title: 'Archived', archived: true,
    });
    await db.insert(branches).values({ id: archivedCourseBranchId, courseId: archivedCourseId, name: 'Old branch' });
    await db.insert(kcs).values({ id: archivedCourseKcId, branchId: archivedCourseBranchId, courseId: archivedCourseId, name: 'Old KC' });
    await db.insert(experiences).values({
      id: archivedExperienceId, courseId: archivedCourseId, kind: 'exercise', intendedProcesses: ['memory_fluency'], sortOrder: -1,
      content: { schema_version: 1, kind: 'worked', prompt: 'Old', solution: 'Old' }, evidenceResponseType: 'constructed_response',
    });
    await db.insert(experienceKcs).values({
      experienceId: archivedExperienceId, kcId: archivedCourseKcId, courseId: archivedCourseId, isEvidenceTarget: true,
    });

    const result = await getNextExperience(db, learnerId, now);
    expect(result.experience.id).toBe(experienceId);
    expect(result.reasons).toEqual([`ready unmet KC ${contextKcId}`]);
  });
});
