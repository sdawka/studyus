// Audit fixes: grades.getGradesSummary's N+1 replaced with one grouped
// query, and the unscoped `select().from(kcs)` scans in courses.listCourses
// (mastery) / profile.getProfile scoped via a join on courses. All three are
// perf-only changes — behavior must stay byte-for-byte identical to before.
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { assessments, branches, courses, kcs, users } from '../src/db/schema';
import { getGradesSummary } from '../src/lib/services/grades';
import { listCourses } from '../src/lib/services/courses';
import { getProfile } from '../src/lib/services/profile';

const db = getDb(env.DB);

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  otherUserId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
});

describe('getGradesSummary — grouped query across many courses', () => {
  it('computes the same per-course weighted grade for each of several courses in one pass', async () => {
    const courseA = crypto.randomUUID();
    const courseB = crypto.randomUUID();
    await db.insert(courses).values([
      { id: courseA, userId, code: 'A 101', slug: `a-${courseA}`, title: 'A', credits: 3 },
      { id: courseB, userId, code: 'B 101', slug: `b-${courseB}`, title: 'B', credits: 4 },
    ]);
    await db.insert(assessments).values([
      { id: crypto.randomUUID(), courseId: courseA, title: 'A Quiz', type: 'quiz', weightPct: 100, gradeReceived: 80, gradeMax: 100 },
      { id: crypto.randomUUID(), courseId: courseB, title: 'B Quiz', type: 'quiz', weightPct: 100, gradeReceived: 60, gradeMax: 100 },
    ]);

    // Another user's assessment must never leak into this user's summary.
    const foreignCourseId = crypto.randomUUID();
    await db.insert(courses).values({ id: foreignCourseId, userId: otherUserId, code: 'X 1', slug: `x-${foreignCourseId}`, title: 'X' });
    await db.insert(assessments).values({ id: crypto.randomUUID(), courseId: foreignCourseId, title: 'Foreign', type: 'quiz', weightPct: 100, gradeReceived: 10, gradeMax: 100 });

    const summary = await getGradesSummary(db, userId);
    expect(summary.by_course.find((c) => c.course_id === courseA)?.weighted_grade).toBe(80);
    expect(summary.by_course.find((c) => c.course_id === courseB)?.weighted_grade).toBe(60);
    expect(summary.by_course).toHaveLength(2);

    // (80*3 + 60*4) / 7 = (240+240)/7 = 68.57 -> rounds to 68.6
    expect(summary.overall_weighted_grade).toBeCloseTo(68.6, 1);
  });

  it('returns an empty summary with no courses, without erroring on an empty inArray', async () => {
    const summary = await getGradesSummary(db, userId);
    expect(summary.by_course).toEqual([]);
    expect(summary.overall_weighted_grade).toBeNull();
  });
});

describe('listCourses({ includeMastery: true }) — scoped KC aggregation', () => {
  it('computes mastery only from this user’s own KCs, never another user’s', async () => {
    const courseId = crypto.randomUUID();
    await db.insert(courses).values({ id: courseId, userId, code: 'C 1', slug: `c-${courseId}`, title: 'C' });
    const branchId = crypto.randomUUID();
    await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
    await db.insert(kcs).values([
      { id: crypto.randomUUID(), branchId, courseId, name: 'KC1', mastery: 80, status: 'mastered' },
      { id: crypto.randomUUID(), branchId, courseId, name: 'KC2', mastery: 40, status: 'review' },
    ]);

    const foreignCourseId = crypto.randomUUID();
    await db.insert(courses).values({ id: foreignCourseId, userId: otherUserId, code: 'F 1', slug: `f-${foreignCourseId}`, title: 'F' });
    const foreignBranchId = crypto.randomUUID();
    await db.insert(branches).values({ id: foreignBranchId, courseId: foreignCourseId, name: 'Foreign Branch' });
    await db.insert(kcs).values({ id: crypto.randomUUID(), branchId: foreignBranchId, courseId: foreignCourseId, name: 'Foreign KC', mastery: 5, status: 'learning' });

    const rows = await listCourses(db, userId, { includeMastery: true });
    const row = rows.find((c) => c.id === courseId)!;
    expect(row.mastery).toBe(60); // (80+40)/2, unaffected by the foreign KC
  });
});

describe('getProfile — scoped KC aggregation', () => {
  it('computes overall/by-course mastery only from this user’s own courses/KCs', async () => {
    const courseId = crypto.randomUUID();
    await db.insert(courses).values({ id: courseId, userId, code: 'C 1', slug: `c-${courseId}`, title: 'C' });
    const branchId = crypto.randomUUID();
    await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
    await db.insert(kcs).values({ id: crypto.randomUUID(), branchId, courseId, name: 'KC1', mastery: 50 });

    const foreignCourseId = crypto.randomUUID();
    await db.insert(courses).values({ id: foreignCourseId, userId: otherUserId, code: 'F 1', slug: `f-${foreignCourseId}`, title: 'F' });
    const foreignBranchId = crypto.randomUUID();
    await db.insert(branches).values({ id: foreignBranchId, courseId: foreignCourseId, name: 'Foreign Branch' });
    await db.insert(kcs).values({ id: crypto.randomUUID(), branchId: foreignBranchId, courseId: foreignCourseId, name: 'Foreign KC', mastery: 100 });

    const profile = await getProfile(db, userId);
    const courseEntry = profile.by_course.find((c) => c.course_id === courseId)!;
    expect(courseEntry.mastery).toBe(50);
    expect(profile.overall_mastery).toBe(50); // not dragged toward the foreign 100
  });
});
