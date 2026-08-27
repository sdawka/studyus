import { and, count, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assessmentKcs, assessments, branches, courses, exercises, kcEdges, kcs } from '../../db/schema';
import { rankNextMoves, NEXT_MOVE_ASSESSMENT_HORIZON_DAYS, type NextMoveAssessmentInput, type NextMoveKcInput } from '../nextMove';
import type { AvailableMinutes } from '../schemas/nextMove';

const DAY_MS = 24 * 60 * 60 * 1000;
const D1_MAX_BOUND_PARAMS = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function getNextMove(
  db: Db,
  userId: string,
  availableMinutes: AvailableMinutes = 25,
  now: number = Date.now(),
) {
  const [kcRows, assessmentRows, mcqRows] = await Promise.all([
    db
      .select({
        id: kcs.id,
        name: kcs.name,
        kcType: kcs.kcType,
        mastery: kcs.mastery,
        status: kcs.status,
        lastEventAt: kcs.lastEventAt,
        courseId: courses.id,
        courseSlug: courses.slug,
        courseCode: courses.code,
        courseTitle: courses.title,
        courseColor: courses.color,
        branchSortOrder: branches.sortOrder,
        kcSortOrder: kcs.sortOrder,
      })
      .from(kcs)
      .innerJoin(branches, eq(kcs.branchId, branches.id))
      .innerJoin(courses, eq(kcs.courseId, courses.id))
      .where(
        and(
          eq(courses.userId, userId),
          eq(courses.archived, false),
          eq(courses.setupState, 'active'),
          isNull(branches.archivedAt),
          isNull(kcs.archivedAt),
        ),
      ),
    db
      .select({
        id: assessments.id,
        title: assessments.title,
        dueAt: assessments.dueDate,
        weightPct: assessments.weightPct,
        kcId: assessmentKcs.kcId,
      })
      .from(assessments)
      .innerJoin(courses, eq(assessments.courseId, courses.id))
      .leftJoin(assessmentKcs, eq(assessmentKcs.assessmentId, assessments.id))
      .where(
        and(
          eq(courses.userId, userId),
          eq(courses.archived, false),
          eq(courses.setupState, 'active'),
          eq(assessments.kind, 'official'),
          isNull(assessments.gradeReceived),
          isNotNull(assessments.dueDate),
          gte(assessments.dueDate, now),
          lte(assessments.dueDate, now + NEXT_MOVE_ASSESSMENT_HORIZON_DAYS * DAY_MS),
        ),
      ),
    db
      .select({ kcId: exercises.kcId, count: count(exercises.id) })
      .from(exercises)
      .innerJoin(kcs, eq(exercises.kcId, kcs.id))
      .innerJoin(branches, eq(kcs.branchId, branches.id))
      .innerJoin(courses, eq(kcs.courseId, courses.id))
      .where(
        and(
          eq(courses.userId, userId),
          eq(courses.archived, false),
          eq(courses.setupState, 'active'),
          isNull(branches.archivedAt),
          isNull(kcs.archivedAt),
          eq(exercises.kind, 'mcq'),
          isNull(exercises.retiredAt),
        ),
      )
      .groupBy(exercises.kcId),
  ]);

  const kcIds = kcRows.map((row) => row.id);
  const edgeBatches = kcIds.length
    ? await Promise.all(chunk(kcIds, D1_MAX_BOUND_PARAMS).map((ids) => db.select().from(kcEdges).where(inArray(kcEdges.kcId, ids))))
    : [];
  const activeKcIds = new Set(kcIds);
  const prereqsByKc = new Map<string, string[]>();
  for (const edge of edgeBatches.flat()) {
    if (!activeKcIds.has(edge.prereqKcId)) continue;
    const list = prereqsByKc.get(edge.kcId) ?? [];
    list.push(edge.prereqKcId);
    prereqsByKc.set(edge.kcId, list);
  }
  const mcqCountByKc = new Map(mcqRows.map((row) => [row.kcId, row.count]));

  const nextMoveKcs: NextMoveKcInput[] = kcRows.map((row) => ({
    ...row,
    prereqIds: prereqsByKc.get(row.id) ?? [],
    activeMcqCount: mcqCountByKc.get(row.id) ?? 0,
  }));

  const assessmentsById = new Map<string, NextMoveAssessmentInput>();
  for (const row of assessmentRows) {
    if (row.dueAt === null) continue;
    const assessment = assessmentsById.get(row.id) ?? {
      id: row.id,
      title: row.title,
      dueAt: row.dueAt,
      weightPct: row.weightPct,
      kcIds: [],
    };
    if (row.kcId && activeKcIds.has(row.kcId)) assessment.kcIds.push(row.kcId);
    assessmentsById.set(row.id, assessment);
  }

  return rankNextMoves(nextMoveKcs, [...assessmentsById.values()], availableMinutes, now);
}
