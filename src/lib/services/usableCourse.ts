// One definition of "does this learner have a course they can actually use".
//
// One shared definition keeps bootstrap and onboarding validation aligned on
// whether an imported course contains learner-authored substance. Completed
// onboarding is deliberately one-way, so this predicate does not prevent a
// learner from later archiving every course or concept.
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { branches, courses, kcs } from '../../db/schema';
import { isPlaceholderKcName } from '../placeholderKc';

// Re-exported so server callers keep importing the rule from here, while the
// onboarding form can import the browser-safe module directly.
export { PLACEHOLDER_KC_NAMES, isPlaceholderKcName } from '../placeholderKc';

/** Returns the detached course created with a new learner, without backfilling older accounts. */
export async function getProvisionedDefaultCourse(db: Db, userId: string) {
  const rows = await db.select({ id: courses.id, slug: courses.slug }).from(courses)
    // Kept local to this leaf module to avoid a service cycle through
    // learnerBootstrap -> courseDraft -> courses -> usableCourse.
    .where(and(eq(courses.userId, userId), eq(courses.bootstrapKey, 'first-party:learning-how-to-learn')))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Whether `userId` has at least one active, non-archived course carrying a
 * concept that is not a placeholder.
 *
 * `excludeCourseId` supports callers that need to evaluate a workspace without
 * a particular course; it is not an archive authorization rule.
 */
export async function hasUsableCourse(
  db: Db,
  userId: string,
  opts: { excludeCourseId?: string } = {},
): Promise<boolean> {
  const scope = [
    eq(courses.userId, userId),
    eq(courses.archived, false),
    eq(courses.setupState, 'active'),
    isNull(branches.archivedAt),
    isNull(kcs.archivedAt),
    ...(opts.excludeCourseId ? [ne(courses.id, opts.excludeCourseId)] : []),
  ];

  const names = await db
    .select({ name: kcs.name })
    .from(kcs)
    .innerJoin(branches, eq(kcs.branchId, branches.id))
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(...scope))
    .limit(100);

  return names.some((row) => !isPlaceholderKcName(row.name));
}
