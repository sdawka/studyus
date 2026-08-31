// One definition of "does this learner have a course they can actually use".
//
// middleware.ts gates every authenticated page on hasUsableCourse(), so this
// predicate decides whether a learner can reach the app at all rather than
// being bounced to /onboarding. Three separate guards depend on agreeing about
// it — onboarding completion, the course-map editor's "keep at least one
// meaningful active concept" rule, and course archiving — so the placeholder
// list lives here instead of being redeclared per module. It was previously
// declared identically in both onboarding.ts and courseMap.ts; if those copies
// had drifted, the map editor would have allowed a state the middleware treats
// as locked out.
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { branches, courses, kcs } from '../../db/schema';

/**
 * Concept names that a generated or stub course map uses as filler. A course
 * whose only concepts are these has not really been set up, so it does not
 * count toward "usable".
 */
export const PLACEHOLDER_KC_NAMES: ReadonlySet<string> = new Set([
  'general',
  'course topic',
  'course foundations',
]);

/** True when a concept name is filler rather than something the learner chose. */
export function isPlaceholderKcName(name: string): boolean {
  return PLACEHOLDER_KC_NAMES.has(name.trim().toLowerCase());
}

/**
 * Whether `userId` has at least one active, non-archived course carrying a
 * concept that is not a placeholder.
 *
 * `excludeCourseId` answers the forward-looking question "would the learner
 * still have one if this course went away", which is what the archive guard
 * needs before letting a course be archived.
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
