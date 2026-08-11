import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { assessments, courses, users } from '../src/db/schema';
import { getGradesSummary } from '../src/lib/services/grades';

const db = getDb(env.DB);

let userId: string;
let courseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course', credits: 3 });
});

describe('grades.getGradesSummary', () => {
  it('computes sum(grade% x weight) / sum(weight) over graded assessments only', async () => {
    await db.insert(assessments).values([
      { id: crypto.randomUUID(), courseId, title: 'Quiz 1', type: 'quiz', weightPct: 20, gradeReceived: 18, gradeMax: 20 }, // 90%
      { id: crypto.randomUUID(), courseId, title: 'Midterm', type: 'midterm', weightPct: 30, gradeReceived: 75, gradeMax: 100 }, // 75%
      { id: crypto.randomUUID(), courseId, title: 'Final', type: 'final', weightPct: 50 }, // ungraded — excluded
    ]);

    const summary = await getGradesSummary(db, userId);
    const course = summary.by_course.find((c) => c.course_id === courseId)!;

    // (90*20 + 75*30) / (20+30) = (1800+2250)/50 = 81
    expect(course.weighted_grade).toBe(81);
    expect(summary.overall_weighted_grade).toBe(81);
  });

  it('returns null weighted_grade for a course with no graded assessments', async () => {
    await db.insert(assessments).values({ id: crypto.randomUUID(), courseId, title: 'Final', type: 'final', weightPct: 100 });
    const summary = await getGradesSummary(db, userId);
    const course = summary.by_course.find((c) => c.course_id === courseId)!;
    expect(course.weighted_grade).toBeNull();
  });
});
