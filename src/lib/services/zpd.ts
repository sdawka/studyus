// ZPD (zone of proximal development) reads — pure (db, userId, input)
// wrappers around src/lib/zpd.ts's frontier selector. Computed on read from
// kcs + kc_edges, zero persistence (see docs/api.md's ZPD section and
// data-model.md).
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { branches, courses, kcEdges, kcs } from '../../db/schema';
import type { FrontierByCourse, FrontierResponse } from '../schemas/zpd';
import { computeReadiness, selectFrontier, type ZpdKc } from '../zpd';
import { chunk, requireOwnedCourse } from './util';

// D1's bound-parameter cap is 100 per query — a whole-profile scope (all of
// a user's non-archived courses' KCs, e.g. 147 across the 9 seeded courses)
// blows past that in one `inArray` call, so this chunks scopeIds into
// batches and unions the results. Every other `inArray` caller in this file
// stays on a single course's KCs (well under the cap), so only this one
// needed it.
const D1_MAX_BOUND_PARAMS = 100;

/** kcId -> its prereqKcId list, restricted to `kcId in scopeIds`. */
async function loadPrereqsOf(db: Db, scopeIds: string[]): Promise<Map<string, string[]>> {
  const prereqsOf = new Map<string, string[]>();
  if (scopeIds.length === 0) return prereqsOf;
  const batches = await Promise.all(
    chunk(scopeIds, D1_MAX_BOUND_PARAMS).map((batch) => db.select().from(kcEdges).where(inArray(kcEdges.kcId, batch))),
  );
  for (const row of batches.flat()) {
    const list = prereqsOf.get(row.kcId) ?? [];
    list.push(row.prereqKcId);
    prereqsOf.set(row.kcId, list);
  }
  return prereqsOf;
}

/**
 * All KCs across the user's non-archived courses + every kc_edge among
 * them, folded through selectFrontier and grouped by course. Cross-course
 * prereqs gate correctly for free here since every owned non-archived
 * course's KCs are loaded together in one scope.
 */
export async function getGlobalFrontier(db: Db, userId: string): Promise<FrontierResponse> {
  const userCourses = await db
    .select()
    .from(courses)
    .where(and(eq(courses.userId, userId), eq(courses.archived, false)));
  const courseIds = userCourses.map((c) => c.id);

  if (courseIds.length === 0) {
    return { by_course: [], counts: { frontier: 0, blocked: 0, mastered: 0, total: 0 } };
  }

  const rows = await db.select({ kc: kcs }).from(kcs).innerJoin(branches, eq(kcs.branchId, branches.id))
    .where(and(inArray(kcs.courseId, courseIds), isNull(kcs.archivedAt), isNull(branches.archivedAt))).then((items) => items.map((item) => item.kc));
  const kcIdSet = new Set(rows.map((r) => r.id));
  const prereqsOf = await loadPrereqsOf(db, [...kcIdSet]);

  type Row = ZpdKc & { name: string; slug: string | null; courseId: string };
  const zpdKcs: Row[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    mastery: r.mastery,
    name: r.name,
    slug: r.slug,
    courseId: r.courseId,
    // "all kc_edges among them" — an edge to a KC outside this non-archived
    // owned scope is dropped rather than treated as an auto-block.
    prereqIds: (prereqsOf.get(r.id) ?? []).filter((id) => kcIdSet.has(id)),
  }));

  const { frontier, blocked } = selectFrontier(zpdKcs);
  const masteredCount = rows.filter((r) => r.status === 'mastered').length;

  const frontierByCourseId = new Map<string, Row[]>();
  for (const kc of frontier) {
    const list = frontierByCourseId.get(kc.courseId) ?? [];
    list.push(kc);
    frontierByCourseId.set(kc.courseId, list);
  }

  const by_course: FrontierByCourse[] = userCourses
    .filter((c) => (frontierByCourseId.get(c.id) ?? []).length > 0)
    .map((c) => ({
      course_id: c.id,
      course_title: c.title,
      course_slug: c.slug,
      color: c.color,
      frontier: (frontierByCourseId.get(c.id) ?? []).map((kc) => ({
        kc_id: kc.id,
        name: kc.name,
        slug: kc.slug,
        mastery: kc.mastery,
        status: kc.status as FrontierByCourse['frontier'][number]['status'],
      })),
    }));

  return {
    by_course,
    counts: { frontier: frontier.length, blocked: blocked.length, mastered: masteredCount, total: rows.length },
  };
}

export type KcReadiness = {
  id: string;
  // Not-yet-ready prerequisites (id + name, so the UI can link to them),
  // empty when fully ready. Merges directly into UnderstandNextKc.unreadyPrereqs.
  unreadyPrereqs: { id: string; name: string }[];
};

/**
 * One course's KCs, gated by both in-course AND one-hop out-of-course
 * prereqs (a cross-course prereq is loaded just far enough to read its own
 * readiness — its own prereqs aren't traversed further).
 */
export async function getCourseReadiness(db: Db, userId: string, courseId: string): Promise<KcReadiness[]> {
  await requireOwnedCourse(db, userId, courseId);

  const courseKcs = await db.select({ kc: kcs }).from(kcs).innerJoin(branches, eq(kcs.branchId, branches.id))
    .where(and(eq(kcs.courseId, courseId), isNull(kcs.archivedAt), isNull(branches.archivedAt))).then((items) => items.map((item) => item.kc));
  const courseKcIds = courseKcs.map((k) => k.id);
  if (courseKcIds.length === 0) return [];

  const prereqsOf = await loadPrereqsOf(db, courseKcIds);
  const courseKcIdSet = new Set(courseKcIds);
  const outOfCourseIds = [...new Set([...prereqsOf.values()].flat())].filter((id) => !courseKcIdSet.has(id));

  const outOfCourseRows = outOfCourseIds.length
    ? await db
        .select({ id: kcs.id, name: kcs.name, status: kcs.status, mastery: kcs.mastery })
        .from(kcs)
        .innerJoin(branches, eq(kcs.branchId, branches.id))
        .innerJoin(courses, eq(kcs.courseId, courses.id))
        .where(and(inArray(kcs.id, outOfCourseIds), eq(courses.userId, userId), isNull(kcs.archivedAt), isNull(branches.archivedAt)))
    : [];

  const nameById = new Map<string, string>();
  for (const k of courseKcs) nameById.set(k.id, k.name);
  for (const r of outOfCourseRows) nameById.set(r.id, r.name);

  const combined: ZpdKc[] = [
    ...courseKcs.map((k) => ({ id: k.id, status: k.status, mastery: k.mastery, prereqIds: prereqsOf.get(k.id) ?? [] })),
    // One hop out — no further prereq traversal, we only need their own
    // readiness, not whether *they're* blocked.
    ...outOfCourseRows.map((r) => ({ id: r.id, status: r.status, mastery: r.mastery, prereqIds: [] as string[] })),
  ];
  const readiness = computeReadiness(combined);

  return courseKcs.map((k) => {
    const prereqIds = prereqsOf.get(k.id) ?? [];
    const unreadyPrereqs = prereqIds
      .filter((id) => !(readiness.get(id) ?? false))
      .map((id) => ({ id, name: nameById.get(id) ?? id }));
    return { id: k.id, unreadyPrereqs };
  });
}
