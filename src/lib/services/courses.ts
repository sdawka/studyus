import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { branches, courses, kcs } from '../../db/schema';
import { NotFoundError } from './util';

export async function listCourses(db: Db, userId: string, opts: { includeMastery?: boolean } = {}) {
  const rows = await db.select().from(courses).where(eq(courses.userId, userId));
  if (!opts.includeMastery) return rows.map((c) => ({ ...c, mastery: null, status: null }));

  const allKcs = await db.select({ courseId: kcs.courseId, mastery: kcs.mastery, status: kcs.status }).from(kcs);
  const byCourse = new Map<string, { mastery: number; status: string }[]>();
  for (const kc of allKcs) {
    const list = byCourse.get(kc.courseId) ?? [];
    list.push({ mastery: kc.mastery, status: kc.status });
    byCourse.set(kc.courseId, list);
  }

  return rows.map((c) => {
    const courseKcs = byCourse.get(c.id) ?? [];
    const mastery = courseKcs.length
      ? Math.round(courseKcs.reduce((sum, k) => sum + k.mastery, 0) / courseKcs.length)
      : 0;
    // A course only reads as "learning"+ once some KC actually has event
    // evidence — averaging mastery alone can't distinguish "9 untouched
    // KCs" from "a course just getting started" (both average to 0).
    const hasEvidence = courseKcs.some((k) => k.status !== 'not-started');
    const status =
      courseKcs.length === 0 || !hasEvidence
        ? 'not-started'
        : mastery >= 80
          ? 'mastered'
          : mastery >= 40
            ? 'review'
            : 'learning';
    return { ...c, mastery, status };
  });
}

export async function getCourseBySlug(db: Db, userId: string, slug: string) {
  const rows = await db.select().from(courses).where(and(eq(courses.slug, slug), eq(courses.userId, userId))).limit(1);
  const course = rows[0];
  if (!course) throw new NotFoundError('Course');

  const courseBranches = await db
    .select()
    .from(branches)
    .where(eq(branches.courseId, course.id))
    .orderBy(asc(branches.sortOrder));

  const courseKcs = await db.select().from(kcs).where(eq(kcs.courseId, course.id)).orderBy(asc(kcs.sortOrder));

  const kcsByBranch = new Map<string, typeof courseKcs>();
  for (const kc of courseKcs) {
    const list = kcsByBranch.get(kc.branchId) ?? [];
    list.push(kc);
    kcsByBranch.set(kc.branchId, list);
  }

  return {
    ...course,
    branches: courseBranches.map((b) => ({ ...b, kcs: kcsByBranch.get(b.id) ?? [] })),
  };
}
