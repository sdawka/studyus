import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { assessmentKcs, assessments, branches, courses, exercises, kcs, users } from '../src/db/schema';
import { rankNextMoves, type NextMoveAssessmentInput, type NextMoveKcInput } from '../src/lib/nextMove';
import { getNextMove } from '../src/lib/services/nextMove';
import { GET as getNextMoveRoute } from '../src/pages/api/v1/profile/next-move';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 7, 27, 12);
const db = getDb(env.DB);

function kc(id: string, overrides: Partial<NextMoveKcInput> = {}): NextMoveKcInput {
  return {
    id,
    name: id,
    kcType: 'concept',
    mastery: 0,
    status: 'not-started',
    lastEventAt: null,
    prereqIds: [],
    activeMcqCount: 0,
    courseId: 'course-a',
    courseSlug: 'course-a',
    courseCode: 'A 101',
    courseTitle: 'Course A',
    courseColor: null,
    branchSortOrder: 0,
    kcSortOrder: 0,
    ...overrides,
  };
}

function assessment(id: string, kcIds: string[], days = 3, overrides: Partial<NextMoveAssessmentInput> = {}): NextMoveAssessmentInput {
  return { id, title: id, dueAt: NOW + days * DAY_MS, weightPct: null, kcIds, ...overrides };
}

describe('rankNextMoves', () => {
  it('balances deadline urgency against mastery and recency', () => {
    const result = rankNextMoves(
      [
        kc('exam-kc', { mastery: 60, status: 'review', lastEventAt: NOW - DAY_MS }),
        kc('stale-kc', { mastery: 20, status: 'learning', lastEventAt: NOW - 30 * DAY_MS, kcSortOrder: 1 }),
      ],
      [assessment('midterm', ['exam-kc'], 1)],
      25,
      NOW,
    );
    expect(result.recommendation?.kc.kc_id).toBe('exam-kc');
    expect(result.recommendation?.kind).toBe('assessment_practice');
    expect(result.recommendation?.reasons[0].code).toBe('assessment_urgency');
    expect(result.recommendation?.reasons.at(-1)?.code).toBe('time_fit');
  });

  it('labels an assessment later on the same calendar day as due today', () => {
    const result = rankNextMoves(
      [kc('same-day')],
      [assessment('today-exam', ['same-day'], 0, { dueAt: NOW + 8 * 60 * 60 * 1000 })],
      25,
      NOW,
    );
    expect(result.recommendation?.reasons[0].label).toContain('due today');
  });

  it('recursively redirects a blocked assessment target to its actionable cross-course prerequisite', () => {
    const result = rankNextMoves(
      [
        kc('foundation', { mastery: 10, status: 'learning', courseId: 'other', courseCode: 'B 100' }),
        kc('middle', { mastery: 0, status: 'not-started', prereqIds: ['foundation'] }),
        kc('target', { mastery: 0, status: 'not-started', prereqIds: ['middle'] }),
      ],
      [assessment('final', ['target'], 2)],
      25,
      NOW,
    );
    expect(result.recommendation?.kc.kc_id).toBe('foundation');
    expect(result.recommendation?.kind).toBe('prerequisite_repair');
    expect(result.recommendation?.reasons.some((reason) => reason.code === 'prerequisite_repair')).toBe(true);
  });

  it('deduplicates one KC across assessments and keeps the nearest context', () => {
    const result = rankNextMoves(
      [kc('shared', { mastery: 50, status: 'review', activeMcqCount: 8 })],
      [assessment('later', ['shared'], 10), assessment('nearer', ['shared'], 2)],
      50,
      NOW,
    );
    expect(result.recommendation?.assessment?.assessment_id).toBe('nearer');
    expect(result.alternatives).toHaveLength(0);
    expect(result.recommendation?.method).toBe('quick_quiz');
    expect(result.recommendation?.question_count).toBe(8);
  });

  it('uses weight only to break otherwise-equal assessment candidates', () => {
    const result = rankNextMoves(
      [kc('low-weight'), kc('high-weight', { kcSortOrder: 1 })],
      [assessment('low', ['low-weight'], 5, { weightPct: 10 }), assessment('high', ['high-weight'], 5, { weightPct: 40 })],
      25,
      NOW,
    );
    expect(result.recommendation?.kc.kc_id).toBe('high-weight');
  });

  it('falls back to Understand when the authored bank cannot fill the selected budget', () => {
    const result = rankNextMoves(
      [kc('review', { mastery: 65, status: 'review', activeMcqCount: 4 })],
      [],
      25,
      NOW,
    );
    expect(result.recommendation?.method).toBe('understand');
    expect(result.recommendation?.action_href).toBe('/learn/review?minutes=25');
  });

  it('keeps an exam-linked mastered KC eligible but excludes generic mastered KCs', () => {
    const exam = rankNextMoves([kc('mastered', { mastery: 90, status: 'mastered', activeMcqCount: 3 })], [assessment('exam', ['mastered'], 1)], 15, NOW);
    expect(exam.recommendation?.kc.kc_id).toBe('mastered');
    expect(exam.recommendation?.method).toBe('quick_quiz');
    expect(rankNextMoves([kc('mastered', { mastery: 90, status: 'mastered' })], [], 25, NOW).recommendation).toBeNull();
  });

  it('is deterministic regardless of input order', () => {
    const rows = [kc('a'), kc('b')];
    const first = rankNextMoves(rows, [], 25, NOW);
    const second = rankNextMoves([...rows].reverse(), [], 25, NOW);
    expect(first).toEqual(second);
  });

  it('does not surface an impossible downstream target when a legacy cycle has no actionable repair', () => {
    const result = rankNextMoves(
      [kc('a', { prereqIds: ['b'] }), kc('b', { prereqIds: ['a'] })],
      [assessment('exam', ['a'], 1)],
      25,
      NOW,
    );
    expect(result.recommendation).toBeNull();
  });
});

describe('getNextMove', () => {
  it('loads only active owned content and returns a bank-backed exact quiz', async () => {
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const courseId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const kcId = crypto.randomUUID();
    const assessmentId = crypto.randomUUID();
    const otherCourseId = crypto.randomUUID();
    const otherBranchId = crypto.randomUUID();
    const otherKcId = crypto.randomUUID();
    await db.batch([
      db.insert(users).values({ id: userId, email: `${userId}@next.test`, passwordHash: 'x' }),
      db.insert(users).values({ id: otherUserId, email: `${otherUserId}@next.test`, passwordHash: 'x' }),
      db.insert(courses).values({ id: courseId, userId, code: 'OWN 101', slug: `own-${courseId}`, title: 'Owned' }),
      db.insert(branches).values({ id: branchId, courseId, name: 'Main' }),
      db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Owned KC', mastery: 55, status: 'review', lastEventAt: NOW - 8 * DAY_MS }),
      db.insert(assessments).values({ id: assessmentId, courseId, title: 'Midterm', type: 'midterm', kind: 'official', dueDate: NOW + DAY_MS }),
      db.insert(assessmentKcs).values({ id: crypto.randomUUID(), assessmentId, kcId }),
      db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'OTHER', slug: `other-${otherCourseId}`, title: 'Other' }),
      db.insert(branches).values({ id: otherBranchId, courseId: otherCourseId, name: 'Other' }),
      db.insert(kcs).values({ id: otherKcId, branchId: otherBranchId, courseId: otherCourseId, name: 'Foreign KC' }),
    ]);
    for (let index = 0; index < 3; index++) {
      await db.insert(exercises).values({
        id: crypto.randomUUID(), kcId, slug: `next-${kcId}-${index}`, kind: 'mcq', prompt: `Q${index}`,
        details: { options: ['A', 'B', 'C'], correct_index: 0, explanation: 'A' }, source: 'test', sortOrder: index,
      });
    }

    const result = await getNextMove(db, userId, 15, NOW);
    expect(result.recommendation).toMatchObject({ method: 'quick_quiz', planned_minutes: 15, kc: { kc_id: kcId } });
    expect([result.recommendation, ...result.alternatives].some((move) => move?.kc.kc_id === otherKcId)).toBe(false);

    const response = await getNextMoveRoute({
      locals: { user: { id: userId } },
      url: new URL('http://localhost/api/v1/profile/next-move?available_minutes=15'),
    } as any);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { available_minutes: number; recommendation: { kc: { kc_id: string } } | null } };
    expect(body.data.available_minutes).toBe(15);
    expect(body.data.recommendation?.kc.kc_id).toBe(kcId);
  });

  it('rejects unsupported time budgets at the route boundary', async () => {
    const response = await getNextMoveRoute({
      locals: { user: { id: crypto.randomUUID() } },
      url: new URL('http://localhost/api/v1/profile/next-move?available_minutes=30'),
    } as any);
    expect(response.status).toBe(400);
  });
});
