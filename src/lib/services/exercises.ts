// v2.0 exercise bank reads: auto-gradeable / self-checkable items attached to
// KCs, populated from courses/<slug>/exercises.json by scripts/seed.ts (see
// courses/exercise-schema.md for the frozen authoring contract and
// docs/api.md's v2.0 section for the API shapes this backs).
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, exercises, kcs } from '../../db/schema';
import type { ExerciseKind } from '../content/exercises';
import { NotFoundError, requireOwnedCourse, requireOwnedKc } from './util';

export type ExerciseRow = typeof exercises.$inferSelect;

type McqDetails = { options: string[]; correct_index: number; explanation: string };
type NumericDetails = { answer: { value: number; unit: string | null; tolerance_pct: number }; solution: string };
type WorkedDetails = { solution: string };

// Answer-stripped by default: mcq keeps only `options` (no correct_index/
// explanation), numeric keeps only `unit` (no value/tolerance/solution),
// worked's solution IS the content so it's never stripped. `withAnswers`
// (or the listCourseMcqBank helper below) returns the full details payload
// for server-side grading — never send that shape to the client unprompted.
export type ShapedExercise = Omit<ExerciseRow, 'details'> & {
  details: McqDetails | NumericDetails | WorkedDetails | { options: string[] } | { unit: string | null };
};

function shapeExercise(row: ExerciseRow, withAnswers: boolean): ShapedExercise {
  if (withAnswers) return row as ShapedExercise;

  const details = row.details as McqDetails | NumericDetails | WorkedDetails;
  switch (row.kind) {
    case 'mcq':
      return { ...row, details: { options: (details as McqDetails).options } };
    case 'numeric':
      return { ...row, details: { unit: (details as NumericDetails).answer.unit } };
    case 'worked':
      return { ...row, details: details as WorkedDetails };
  }
}

/**
 * Lists a KC's exercises, ordered by sort_order. Answer-stripped by default
 * (see ShapedExercise) — pass `withAnswers: true` for server-side grading use
 * (e.g. a future numeric-answer-check endpoint); never surface that variant
 * directly to a client response.
 */
export async function listKcExercises(
  db: Db,
  userId: string,
  kcId: string,
  opts: { kind?: ExerciseKind; withAnswers?: boolean } = {},
): Promise<ShapedExercise[]> {
  await requireOwnedKc(db, userId, kcId);

  const conditions = [eq(exercises.kcId, kcId)];
  if (opts.kind) conditions.push(eq(exercises.kind, opts.kind));

  const rows = await db
    .select()
    .from(exercises)
    .where(and(...conditions))
    .orderBy(asc(exercises.sortOrder));

  return rows.map((row) => shapeExercise(row, opts.withAnswers ?? false));
}

/**
 * Every seeded `mcq` exercise across a course, WITH full details (options +
 * correct_index + explanation) — the reading surface QuickQuiz's server-side
 * grading needs (that integration lands in a later track; this just exposes
 * the query it will call). Never route this straight to a client response.
 */
export async function listCourseMcqBank(db: Db, userId: string, courseId: string): Promise<ExerciseRow[]> {
  await requireOwnedCourse(db, userId, courseId);

  return db
    .select({ exercise: exercises })
    .from(exercises)
    .innerJoin(kcs, eq(exercises.kcId, kcs.id))
    .where(and(eq(kcs.courseId, courseId), eq(exercises.kind, 'mcq')))
    .orderBy(asc(exercises.sortOrder))
    .then((rows) => rows.map((r) => r.exercise));
}

/**
 * Loads a single exercise WITH full details (mcq: correct_index/explanation;
 * numeric: answer/solution), ownership-checked via its KC's course — the
 * reading surface the numeric/mcq attempt-grading flow needs. Never route
 * this straight to a client response.
 */
export async function getExerciseWithAnswers(db: Db, userId: string, exerciseId: string): Promise<ExerciseRow> {
  const rows = await db
    .select({ exercise: exercises, courseUserId: courses.userId })
    .from(exercises)
    .innerJoin(kcs, eq(exercises.kcId, kcs.id))
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(eq(exercises.id, exerciseId))
    .limit(1);
  const row = rows[0];
  if (!row || row.courseUserId !== userId) throw new NotFoundError('Exercise');
  return row.exercise;
}
