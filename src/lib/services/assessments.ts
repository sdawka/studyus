// Assessments CRUD. Entering (or changing) grade_received on a graded
// assessment auto-appends one assessment-role event per linked
// assessment_kcs row via the events service, so the linked KCs' mastery
// caches move in the same request.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assessmentKcs, assessments, courses } from '../../db/schema';
import type { CreateAssessmentInput, UpdateAssessmentInput, AssessmentType } from '../schemas/assessments';
import { toEpochMs } from '../schemas/common';
import { createEvent } from './events';
import type { EventType } from '../schemas/events';
import { createNotification } from './notifications';
import { NotFoundError, requireOwnedCourse } from './util';

// Single source of truth for assessment type -> assessment event type,
// mirroring the EVENT_ROLE_FLAGS mapping in schemas/events.ts.
const ASSESSMENT_EVENT_TYPE: Record<AssessmentType, EventType> = {
  quiz: 'quiz_taken',
  assignment: 'assignment_graded',
  lab: 'assignment_graded',
  midterm: 'exam_graded',
  final: 'exam_graded',
};

export async function listAssessments(db: Db, userId: string, courseId: string) {
  await requireOwnedCourse(db, userId, courseId);
  return db.select().from(assessments).where(eq(assessments.courseId, courseId));
}

export async function createAssessment(db: Db, userId: string, courseId: string, input: CreateAssessmentInput) {
  await requireOwnedCourse(db, userId, courseId);

  const id = crypto.randomUUID();
  await db.insert(assessments).values({
    id,
    courseId,
    title: input.title,
    type: input.type,
    dueDate: input.due_date ? toEpochMs(input.due_date) : null,
    weightPct: input.weight_pct ?? null,
    kind: input.kind ?? 'official',
  });

  if (input.kc_ids?.length) {
    await db.insert(assessmentKcs).values(input.kc_ids.map((kcId) => ({ id: crypto.randomUUID(), assessmentId: id, kcId })));
  }

  const rows = await db.select().from(assessments).where(eq(assessments.id, id)).limit(1);
  return rows[0];
}

async function requireOwnedAssessment(db: Db, userId: string, assessmentId: string) {
  const rows = await db
    .select({ assessment: assessments, courseUserId: courses.userId })
    .from(assessments)
    .innerJoin(courses, eq(assessments.courseId, courses.id))
    .where(eq(assessments.id, assessmentId))
    .limit(1);
  const row = rows[0];
  if (!row || row.courseUserId !== userId) throw new NotFoundError('Assessment');
  return row.assessment;
}

export async function updateAssessment(db: Db, userId: string, assessmentId: string, input: UpdateAssessmentInput) {
  const existing = await requireOwnedAssessment(db, userId, assessmentId);

  const patch: Partial<typeof assessments.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.type !== undefined) patch.type = input.type;
  if (input.due_date !== undefined) patch.dueDate = input.due_date ? toEpochMs(input.due_date) : null;
  if (input.weight_pct !== undefined) patch.weightPct = input.weight_pct;
  if (input.grade_received !== undefined) patch.gradeReceived = input.grade_received;
  if (input.grade_max !== undefined) patch.gradeMax = input.grade_max;
  if (input.kind !== undefined) patch.kind = input.kind;

  await db.update(assessments).set(patch).where(eq(assessments.id, assessmentId));

  const rows = await db.select().from(assessments).where(eq(assessments.id, assessmentId)).limit(1);
  const updated = rows[0];

  const masteryDeltas: Array<{ kc_id: string; old_mastery: number; new_mastery: number }> = [];
  const gradeJustEntered =
    input.grade_received !== undefined && input.grade_received !== null && input.grade_received !== existing.gradeReceived;

  if (gradeJustEntered && updated) {
    const links = await db.select().from(assessmentKcs).where(eq(assessmentKcs.assessmentId, assessmentId));
    const gradeMax = updated.gradeMax ?? 100;
    const score = gradeMax > 0 ? (updated.gradeReceived! / gradeMax) * 100 : undefined;
    const eventType = ASSESSMENT_EVENT_TYPE[updated.type as AssessmentType];

    for (const link of links) {
      const { masteryDeltas: deltas } = await createEvent(db, userId, {
        type: eventType,
        kc_id: link.kcId,
        course_id: updated.courseId,
        payload: score !== undefined ? { score, assessment_id: assessmentId } : { assessment_id: assessmentId },
      });
      masteryDeltas.push(...deltas);
    }

    const pct = gradeMax > 0 ? Math.round((updated.gradeReceived! / gradeMax) * 100) : null;
    await createNotification(db, {
      userId,
      type: 'grade_recorded',
      title: pct !== null ? `Grade recorded: ${updated.title} — ${pct}%` : `Grade recorded: ${updated.title}`,
      courseId: updated.courseId,
      href: `/courses/${(await requireOwnedCourse(db, userId, updated.courseId)).slug}`,
      dedupeKey: `grade_recorded:${assessmentId}`,
    });
  }

  return { assessment: updated, masteryDeltas };
}

export async function deleteAssessment(db: Db, userId: string, assessmentId: string) {
  await requireOwnedAssessment(db, userId, assessmentId);
  await db.delete(assessments).where(eq(assessments.id, assessmentId));
}
