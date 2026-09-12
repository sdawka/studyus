import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { selectNextExperience, type NextExperienceGraph } from '../src/lib/domain/nextExperience';
import type { KcState } from '../src/lib/domain/kcState';
import { getDb } from '../src/db/client';
import { branches, courses, experienceKcs, experiences, kcs, users } from '../src/db/schema';
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
});

describe('getNextExperience', () => {
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
});
