// Practice summary (v1.3.1): course-home readout of how much practice a
// student has done, separate from the official weighted grade (grades.ts).
// Sources: events (practice_done, retrieval_practice, quiz_taken,
// tutor_session) for the course, and assessments with kind='practice'.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assessments, branches, events, kcs } from '../../db/schema';
import { requireOwnedCourse } from './util';

const PRACTICE_EVENT_TYPES = ['practice_done', 'retrieval_practice', 'quiz_taken', 'tutor_session'] as const;
const PRACTICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export async function getPracticeSummary(db: Db, userId: string, courseId: string, now: number = Date.now()) {
  await requireOwnedCourse(db, userId, courseId);

  const practiceEvents = await db
    .select({ ts: events.ts, kcId: events.kcId })
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.courseId, courseId), inArray(events.type, PRACTICE_EVENT_TYPES)));

  const windowStart = now - PRACTICE_WINDOW_MS;
  const events30d = practiceEvents.filter((e) => e.ts >= windowStart);

  // All-time KC coverage — distinct kc_id, not windowed.
  const distinctKcs = new Set(practiceEvents.filter((e): e is { ts: number; kcId: string } => e.kcId !== null).map((e) => e.kcId));

  const lastPracticedAt = practiceEvents.reduce<number | null>((max, e) => (max === null || e.ts > max ? e.ts : max), null);

  const courseKcs = await db.select({ id: kcs.id }).from(kcs).innerJoin(branches, eq(kcs.branchId, branches.id))
    .where(and(eq(kcs.courseId, courseId), isNull(kcs.archivedAt), isNull(branches.archivedAt)));

  const practiceAssessments = await db
    .select({ gradeReceived: assessments.gradeReceived })
    .from(assessments)
    .where(and(eq(assessments.courseId, courseId), eq(assessments.kind, 'practice')));

  return {
    // Not valid camelCase (the digit breaks toApi's camelToSnake regex), so
    // this key is written already snake_case — toApi passes an
    // already-snake, non-`_at`/`_date` key through unchanged.
    practice_events_30d: events30d.length,
    distinctKcsPracticed: distinctKcs.size,
    totalKcs: courseKcs.length,
    lastPracticedAt,
    practiceAssessmentsDone: practiceAssessments.filter((a) => a.gradeReceived !== null).length,
    practiceAssessmentsTotal: practiceAssessments.length,
  };
}
