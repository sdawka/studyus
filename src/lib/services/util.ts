// Shared service-layer helpers: typed errors routes translate to HTTP status,
// and ownership assertions (every table is user_id-scoped, directly or via
// its parent course) that every service query must apply.
import { eq, and } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, kcs } from '../../db/schema';

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Not permitted') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** Loads a course and throws NotFoundError unless it belongs to `userId`. */
export async function requireOwnedCourse(db: Db, userId: string, courseId: string) {
  const rows = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)))
    .limit(1);
  const course = rows[0];
  if (!course) throw new NotFoundError('Course');
  return course;
}

/** Loads a KC and throws NotFoundError unless its course belongs to `userId`. */
export async function requireOwnedKc(db: Db, userId: string, kcId: string) {
  const rows = await db
    .select({ kc: kcs, courseUserId: courses.userId })
    .from(kcs)
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(eq(kcs.id, kcId))
    .limit(1);
  const row = rows[0];
  if (!row || row.courseUserId !== userId) throw new NotFoundError('KC');
  return row.kc;
}
