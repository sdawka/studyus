// Assessments CRUD. Entering (or changing) grade_received on a graded
// assessment auto-appends one assessment-role event per linked
// assessment_kcs row via the events service, so the linked KCs' mastery
// caches move in the same request.
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assessmentKcs, assessments, courses, kcs, tasks } from '../../db/schema';
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
    .where(and(inArray(kcs.id, kcIds), eq(kcs.courseId, courseId)));
  if (owned.length !== kcIds.length) throw new NotFoundError('KC');
}

export async function listAssessments(db: Db, userId: string, courseId: string) {
  await requireOwnedCourse(db, userId, courseId);
  const rows = await db.select().from(assessments).where(eq(assessments.courseId, courseId));
  return attachKcIds(db, rows);
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
    const dedupedIds = [...new Set(input.kc_ids)];
    await requireKcsInCourse(db, courseId, dedupedIds);
    await db.insert(assessmentKcs).values(dedupedIds.map((kcId) => ({ id: crypto.randomUUID(), assessmentId: id, kcId })));
  }

  const rows = await db.select().from(assessments).where(eq(assessments.id, id)).limit(1);
  const [created] = await attachKcIds(db, rows);
  return created;
}

// kc_ids replace-links (not additive — see updateAssessmentSchema's doc
// comment): a no-op if the requested set already matches (keeps qmatrix
// version from churning on a PATCH that didn't actually change links),
// otherwise deletes and reinserts the full set at the next qmatrix version.
async function replaceAssessmentKcLinks(db: Db, assessmentId: string, courseId: string, kcIds: string[]): Promise<void> {
  const dedupedIds = [...new Set(kcIds)];
  const existingLinks = await db.select().from(assessmentKcs).where(eq(assessmentKcs.assessmentId, assessmentId));

  const currentIds = new Set(existingLinks.map((l) => l.kcId));
  const nextIds = new Set(dedupedIds);
  const unchanged = currentIds.size === nextIds.size && [...currentIds].every((kcId) => nextIds.has(kcId));
  if (unchanged) return;

  await requireKcsInCourse(db, courseId, dedupedIds);

  const nextVersion = existingLinks.length > 0 ? Math.max(...existingLinks.map((l) => l.qmatrixVersion)) + 1 : 1;

  await db.delete(assessmentKcs).where(eq(assessmentKcs.assessmentId, assessmentId));
  if (dedupedIds.length > 0) {
    await db
      .insert(assessmentKcs)
      .values(dedupedIds.map((kcId) => ({ id: crypto.randomUUID(), assessmentId, kcId, qmatrixVersion: nextVersion })));
  }
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

  // A kc_ids-only PATCH (no other fields) leaves `patch` empty — Drizzle's
  // .set({}) throws "No values to set" on SQLite, so skip the no-op update.
  if (Object.keys(patch).length > 0) {
    await db.update(assessments).set(patch).where(eq(assessments.id, assessmentId));
  }

  const rows = await db.select().from(assessments).where(eq(assessments.id, assessmentId)).limit(1);
  const updated = rows[0];

  // kc_ids handling goes here — after the field patch above, before the
  // gradeJustEntered fan-out below — so a single PATCH that links KCs and
  // enters a grade fans mastery events out over the NEW links, not the
  // stale ones.
  if (input.kc_ids !== undefined) {
    await replaceAssessmentKcLinks(db, assessmentId, existing.courseId, input.kc_ids);
  }

  const masteryDeltas: Array<{ kc_id: string; old_mastery: number; new_mastery: number }> = [];
  const gradeJustEntered =
    input.grade_received !== undefined && input.grade_received !== null && input.grade_received !== existing.gradeReceived;
  // v1.4: the counterpart transition — clearing a grade back to null. The
  // grade_entry task's dedupe key is stable (`grade_entry:<id>`), so once
  // ON CONFLICT DO NOTHING has seen it the sweep can never regenerate a
  // fresh row; reopening the existing one is the only way back to an open
  // state.
  const gradeJustCleared =
    input.grade_received !== undefined && input.grade_received === null && existing.gradeReceived !== null;

  if (gradeJustEntered && updated) {
    const links = await db.select().from(assessmentKcs).where(eq(assessmentKcs.assessmentId, assessmentId));
    const gradeMax = updated.gradeMax ?? 100;
    const score = gradeMax > 0 ? (updated.gradeReceived! / gradeMax) * 100 : undefined;
    const eventType = ASSESSMENT_EVENT_TYPE[updated.type as AssessmentType];

    // Each linked KC's fold is independent (distinct kc_id, no shared
    // mutable row) — run the fan-out concurrently instead of one round-trip
    // per link.
    const eventResults = await Promise.all(
      links.map((link) =>
        createEvent(db, userId, {
          type: eventType,
          kc_id: link.kcId,
          course_id: updated.courseId,
          payload: score !== undefined ? { score, assessment_id: assessmentId } : { assessment_id: assessmentId },
        }),
      ),
    );
    for (const { masteryDeltas: deltas } of eventResults) masteryDeltas.push(...deltas);

    const pct = gradeMax > 0 ? Math.round((updated.gradeReceived! / gradeMax) * 100) : null;
    await createNotification(db, {
      userId,
      type: 'grade_recorded',
      title: pct !== null ? `Grade recorded: ${updated.title} — ${pct}%` : `Grade recorded: ${updated.title}`,
      courseId: updated.courseId,
      href: `/courses/${(await requireOwnedCourse(db, userId, updated.courseId)).slug}`,
      dedupeKey: `grade_recorded:${assessmentId}`,
    });

    // v1.4: entering a grade auto-completes the linked grade_entry task (if
    // any, and not already done). Raw update, never the tasks service — same
    // loop-safety rationale as the classSessions sync in classSessions.ts.
    await db
      .update(tasks)
      .set({ done: true, completedAt: Date.now() })
      .where(and(eq(tasks.assessmentId, assessmentId), eq(tasks.type, 'grade_entry'), eq(tasks.done, false)));
  }

  if (gradeJustCleared) {
    // Reopen only — dismissed_at is left untouched, so a task the student
    // explicitly dismissed doesn't resurface just because the grade was
    // cleared.
    await db
      .update(tasks)
      .set({ done: false, completedAt: null })
      .where(and(eq(tasks.assessmentId, assessmentId), eq(tasks.type, 'grade_entry'), eq(tasks.done, true)));
  }

  const [updatedWithKcIds] = await attachKcIds(db, updated ? [updated] : []);
  return { assessment: updatedWithKcIds ?? updated, masteryDeltas };
}

export async function deleteAssessment(db: Db, userId: string, assessmentId: string) {
  await requireOwnedAssessment(db, userId, assessmentId);
  await db.delete(assessments).where(eq(assessments.id, assessmentId));
}
