// Assessments CRUD. Entering (or changing) grade_received on a graded
// assessment auto-appends one assessment-role event per linked
// assessment_kcs row via the events service, so the linked KCs' mastery
// caches move in the same request.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import { assessmentKcs, assessments, branches, courses, kcs, tasks, users } from '../../db/schema';
import type { CreateAssessmentInput, UpdateAssessmentInput, AssessmentType } from '../schemas/assessments';
import { toEpochMs } from '../schemas/common';
import { appendEventsAtomically, type AtomicEventInput } from './events';
import type { EventType } from '../schemas/events';
import { createNotificationStatement } from './notifications';
import { ConflictError, NotFoundError, requireOwnedCourse, runBatch } from './util';

// Single source of truth for assessment type -> assessment event type,
// mirroring the EVENT_ROLE_FLAGS mapping in schemas/events.ts.
const ASSESSMENT_EVENT_TYPE: Record<AssessmentType, EventType> = {
  quiz: 'quiz_taken',
  assignment: 'assignment_graded',
  lab: 'assignment_graded',
  midterm: 'exam_graded',
  final: 'exam_graded',
};

const ASSESSMENT_REVISION_CONSTRAINT = 'CHECK constraint failed: assessments_revision_nonnegative';

async function requireActiveAssessmentUser(db: Db, userId: string): Promise<void> {
  const row = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, userId), eq(users.accountState, 'active'))).limit(1);
  if (!row[0]) throw new NotFoundError('User');
}

function isAssessmentRevisionConflict(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.message.includes(ASSESSMENT_REVISION_CONSTRAINT)) return true;
    current = current.cause;
  }
  return false;
}

// Grouped inArray attach (mirrors calendar.ts:56-62's task_courses pattern)
// — one query for however many assessments, not one per assessment.
async function attachKcIds<T extends { id: string }>(db: Db, rows: T[]): Promise<(T & { kcIds: string[] })[]> {
  const ids = rows.map((r) => r.id);
  const links = ids.length ? await db.select().from(assessmentKcs).where(inArray(assessmentKcs.assessmentId, ids)) : [];
  const kcIdsByAssessment = new Map<string, string[]>();
  for (const link of links) {
    const list = kcIdsByAssessment.get(link.assessmentId) ?? [];
    list.push(link.kcId);
    kcIdsByAssessment.set(link.assessmentId, list);
  }
  return rows.map((row) => ({ ...row, kcIds: kcIdsByAssessment.get(row.id) ?? [] }));
}

// Cross-course KC injection guard: every id in `kcIds` must be a KC of
// `courseId`, or the whole request 404s. Shared by createAssessment's
// kc_ids and updateAssessment's kc_ids replace below.
async function requireKcsInCourse(db: Db, courseId: string, kcIds: string[]): Promise<void> {
  if (kcIds.length === 0) return;
  const owned = await db
    .select({ id: kcs.id })
    .from(kcs)
    .innerJoin(branches, eq(kcs.branchId, branches.id))
    .where(and(inArray(kcs.id, kcIds), eq(kcs.courseId, courseId), isNull(kcs.archivedAt), isNull(branches.archivedAt)));
  if (owned.length !== kcIds.length) throw new NotFoundError('KC');
}

export async function listAssessments(db: Db, userId: string, courseId: string) {
  await requireActiveAssessmentUser(db, userId);
  await requireOwnedCourse(db, userId, courseId);
  const rows = await db.select().from(assessments).where(eq(assessments.courseId, courseId));
  return attachKcIds(db, rows);
}

export async function createAssessment(db: Db, userId: string, courseId: string, input: CreateAssessmentInput) {
  await requireActiveAssessmentUser(db, userId);
  await requireOwnedCourse(db, userId, courseId);
  const kcIds = [...new Set(input.kc_ids ?? [])];
  await requireKcsInCourse(db, courseId, kcIds);

  const id = crypto.randomUUID();
  const statements: BatchItem<'sqlite'>[] = [
    db.insert(assessments).values({
      id,
      courseId,
      title: input.title,
      type: input.type,
      dueDate: input.due_date ? toEpochMs(input.due_date) : null,
      weightPct: input.weight_pct ?? null,
      kind: input.kind ?? 'official',
    }),
  ];
  if (kcIds.length > 0) {
    statements.push(
      db.insert(assessmentKcs).values(kcIds.map((kcId) => ({ id: crypto.randomUUID(), assessmentId: id, kcId }))),
    );
  }
  await runBatch(db, statements);

  const rows = await db.select().from(assessments).where(eq(assessments.id, id)).limit(1);
  const [created] = await attachKcIds(db, rows);
  return created;
}

// kc_ids replace-links (not additive — see updateAssessmentSchema's doc
// comment): a no-op if the requested set already matches (keeps qmatrix
// version from churning on a PATCH that didn't actually change links),
// otherwise deletes and reinserts the full set at the next qmatrix version.
async function planAssessmentKcReplacement(
  db: Db,
  assessmentId: string,
  courseId: string,
  kcIds: string[],
): Promise<{ kcIds: string[]; statements: BatchItem<'sqlite'>[] }> {
  const dedupedIds = [...new Set(kcIds)];
  const existingLinks = await db.select().from(assessmentKcs).where(eq(assessmentKcs.assessmentId, assessmentId));

  const currentIds = new Set(existingLinks.map((l) => l.kcId));
  const nextIds = new Set(dedupedIds);
  const unchanged = currentIds.size === nextIds.size && [...currentIds].every((kcId) => nextIds.has(kcId));
  if (unchanged) return { kcIds: dedupedIds, statements: [] };

  await requireKcsInCourse(db, courseId, dedupedIds);

  const nextVersion = existingLinks.length > 0 ? Math.max(...existingLinks.map((l) => l.qmatrixVersion)) + 1 : 1;
  const statements: BatchItem<'sqlite'>[] = [db.delete(assessmentKcs).where(eq(assessmentKcs.assessmentId, assessmentId))];
  if (dedupedIds.length > 0) {
    statements.push(
      db
        .insert(assessmentKcs)
        .values(dedupedIds.map((kcId) => ({ id: crypto.randomUUID(), assessmentId, kcId, qmatrixVersion: nextVersion }))),
    );
  }
  return { kcIds: dedupedIds, statements };
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
  await requireActiveAssessmentUser(db, userId);
  const existing = await requireOwnedAssessment(db, userId, assessmentId);

  const patch: Partial<typeof assessments.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.type !== undefined) patch.type = input.type;
  if (input.due_date !== undefined) patch.dueDate = input.due_date ? toEpochMs(input.due_date) : null;
  if (input.weight_pct !== undefined) patch.weightPct = input.weight_pct;
  if (input.grade_received !== undefined) patch.gradeReceived = input.grade_received;
  if (input.grade_max !== undefined) patch.gradeMax = input.grade_max;
  if (input.kind !== undefined) patch.kind = input.kind;

  // The negative sentinel deliberately trips the named D1 CHECK constraint
  // when another update committed after our ownership/snapshot read. Because
  // this statement joins the same batch as links and derived evidence, a
  // stale writer rolls every companion write back before becoming a 409.
  const companionStatements: BatchItem<'sqlite'>[] = [
    db
      .update(assessments)
      .set({
        ...patch,
        revision: sql`case when ${assessments.revision} = ${existing.revision} then ${existing.revision + 1} else -1 end`,
      })
      .where(eq(assessments.id, assessmentId)),
  ];

  let linkedKcIds: string[];
  if (input.kc_ids !== undefined) {
    const replacement = await planAssessmentKcReplacement(db, assessmentId, existing.courseId, input.kc_ids);
    linkedKcIds = replacement.kcIds;
    companionStatements.push(...replacement.statements);
  } else {
    const links = await db.select({ kcId: assessmentKcs.kcId }).from(assessmentKcs).where(eq(assessmentKcs.assessmentId, assessmentId));
    linkedKcIds = links.map((link) => link.kcId);
  }

  const updated = { ...existing, ...patch };
  const gradeJustEntered =
    input.grade_received !== undefined && input.grade_received !== null && input.grade_received !== existing.gradeReceived;
  // v1.4: the counterpart transition — clearing a grade back to null. The
  // grade_entry task's dedupe key is stable (`grade_entry:<id>`), so once
  // ON CONFLICT DO NOTHING has seen it the sweep can never regenerate a
  // fresh row; reopening the existing one is the only way back to an open
  // state.
  const gradeJustCleared =
    input.grade_received !== undefined && input.grade_received === null && existing.gradeReceived !== null;

  const eventInputs: AtomicEventInput[] = [];
  if (gradeJustEntered) {
    const gradeMax = updated.gradeMax ?? 100;
    const score = gradeMax > 0 ? (updated.gradeReceived! / gradeMax) * 100 : undefined;
    const eventType = ASSESSMENT_EVENT_TYPE[updated.type as AssessmentType];
    eventInputs.push(
      ...linkedKcIds.map((kcId) => ({
        type: eventType,
        kc_id: kcId,
        course_id: updated.courseId,
        payload: score !== undefined ? { score, assessment_id: assessmentId } : { assessment_id: assessmentId },
      })),
    );

    const pct = gradeMax > 0 ? Math.round((updated.gradeReceived! / gradeMax) * 100) : null;
    const course = await requireOwnedCourse(db, userId, updated.courseId);
    companionStatements.push(
      createNotificationStatement(db, {
        userId,
        type: 'grade_recorded',
        title: pct !== null ? `Grade recorded: ${updated.title} — ${pct}%` : `Grade recorded: ${updated.title}`,
        courseId: updated.courseId,
        href: `/courses/${course.slug}`,
        dedupeKey: `grade_recorded:${assessmentId}`,
      }),
    );

    // v1.4: entering a grade auto-completes the linked grade_entry task (if
    // any, and not already done). Raw update, never the tasks service — same
    // loop-safety rationale as the classSessions sync in classSessions.ts.
    companionStatements.push(
      db
        .update(tasks)
        .set({ done: true, completedAt: Date.now() })
        .where(and(eq(tasks.assessmentId, assessmentId), eq(tasks.type, 'grade_entry'), eq(tasks.done, false))),
    );
  }

  if (gradeJustCleared) {
    // Reopen only — dismissed_at is left untouched, so a task the student
    // explicitly dismissed doesn't resurface just because the grade was
    // cleared.
    companionStatements.push(
      db
        .update(tasks)
        .set({ done: false, completedAt: null })
        .where(and(eq(tasks.assessmentId, assessmentId), eq(tasks.type, 'grade_entry'), eq(tasks.done, true))),
    );
  }

  const { masteryDeltas } = await appendEventsAtomically(db, userId, eventInputs, 'manual', companionStatements).catch(
    (error: unknown) => {
      if (isAssessmentRevisionConflict(error)) throw new ConflictError('Assessment was updated by another request');
      throw error;
    },
  );
  const rows = await db.select().from(assessments).where(eq(assessments.id, assessmentId)).limit(1);
  const [updatedWithKcIds] = await attachKcIds(db, rows);
  return { assessment: updatedWithKcIds ?? rows[0], masteryDeltas };
}

export async function deleteAssessment(db: Db, userId: string, assessmentId: string) {
  await requireActiveAssessmentUser(db, userId);
  await requireOwnedAssessment(db, userId, assessmentId);
  await db.delete(assessments).where(eq(assessments.id, assessmentId));
}
