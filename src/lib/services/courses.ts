import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { branches, courses, kcs } from '../../db/schema';
import { NotFoundError } from './util';

export async function listCourses(db: Db, userId: string, opts: { includeMastery?: boolean } = {}) {
  const rows = await db.select().from(courses).where(eq(courses.userId, userId));
  if (!opts.includeMastery) return rows.map((c) => ({ ...c, mastery: null, status: null }));

  const allKcs = await db.select({ courseId: kcs.courseId, mastery: kcs.mastery }).from(kcs);
  const byCourse = new Map<string, number[]>();
  for (const kc of allKcs) {
    const list = byCourse.get(kc.courseId) ?? [];
    list.push(kc.mastery);
    byCourse.set(kc.courseId, list);
  }

  return rows.map((c) => {
    const masteries = byCourse.get(c.id) ?? [];
    const mastery = masteries.length ? Math.round(masteries.reduce((a, b) => a + b, 0) / masteries.length) : 0;
    const status = mastery >= 80 ? 'mastered' : mastery >= 40 ? 'review' : masteries.length ? 'learning' : 'not-started';
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
