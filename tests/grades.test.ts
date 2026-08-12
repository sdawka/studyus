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

  it('a graded practice assessment never moves the weighted grade, even with a weight_pct', async () => {
    await db.insert(assessments).values([
      { id: crypto.randomUUID(), courseId, title: 'Midterm', type: 'midterm', weightPct: 50, gradeReceived: 80, gradeMax: 100, kind: 'official' },
      // Same shape as an official row (weighted, graded) but kind='practice' — must be excluded.
      { id: crypto.randomUUID(), courseId, title: 'Practice midterm', type: 'midterm', weightPct: 50, gradeReceived: 40, gradeMax: 100, kind: 'practice' },
    ]);

    const summary = await getGradesSummary(db, userId);
    const course = summary.by_course.find((c) => c.course_id === courseId)!;

    // If the practice row counted, weight_pct sums to 100 and grade would be
    // (80*50+40*50)/100 = 60. Official-only: 80.
    expect(course.weighted_grade).toBe(80);
    expect(summary.overall_weighted_grade).toBe(80);
  });

  it('defaults kind to official on assessments created without one', async () => {
    await db.insert(assessments).values({ id: crypto.randomUUID(), courseId, title: 'Quiz', type: 'quiz', weightPct: 100, gradeReceived: 70, gradeMax: 100 });
    const summary = await getGradesSummary(db, userId);
    const course = summary.by_course.find((c) => c.course_id === courseId)!;
    expect(course.weighted_grade).toBe(70);
    expect(course.assessments[0].kind).toBe('official');
  });
});
