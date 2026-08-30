// Shared service-layer helpers: typed errors routes translate to HTTP status,
// and ownership assertions (every table is user_id-scoped, directly or via
// its parent course) that every service query must apply.
import { eq, and, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import { branches, courses, kcs } from '../../db/schema';

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

// Maps to the `invalid_input` error code at 409 (see apiErrors.ts) — a
// well-formed request that collides with an existing unique row, e.g. a
// manual class session on a date that already has one.
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// Maps to the `invalid_input` error code at 400 (see apiErrors.ts) — the
// submitted attempt shape does not match what the exercise expects. Lives here
// rather than beside the grading flow so apiErrors.ts, which every route
// imports, does not pull the flow and its exercise-bank dependency into every
// route bundle.
export class ExerciseAttemptMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExerciseAttemptMismatchError';
  }
}

/**
 * Runs `statements` as one atomic D1 batch, or does nothing when there are
 * none. Drizzle types `batch` as a non-empty tuple, so every caller would
 * otherwise repeat the same cast; the empty check is what makes the cast safe.
 */
export async function runBatch(db: Db, statements: BatchItem<'sqlite'>[]) {
  if (statements.length) await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

/** Splits `items` into batches of at most `size`, preserving order. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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
    .innerJoin(branches, eq(kcs.branchId, branches.id))
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(eq(kcs.id, kcId), isNull(kcs.archivedAt), isNull(branches.archivedAt)))
    .limit(1);
  const row = rows[0];
  if (!row || row.courseUserId !== userId) throw new NotFoundError('KC');
  return row.kc;
}
