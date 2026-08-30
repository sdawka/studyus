import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import {
  branches,
  courses,
  courseTemplateDecisions,
  exercises,
  kcEdges,
  kcs,
  misconceptions,
  resources,
  scaffolds,
  tasks,
} from '../../db/schema';
import { exerciseDetails } from '../content/exercises';
import { parseKcRef } from '../content/courseContent';
import {
  getReviewedTemplate,
  getReviewedTemplateRevision,
  getTemplateBaseline,
  type TemplateBaseline,
} from '../content/templateCatalog';
import type { ApplyTemplateUpdatesInput, UpdateCourseMapInput } from '../schemas/courseMap';
import { chunk, ConflictError, requireOwnedCourse, runBatch } from './util';

const PLACEHOLDER_KCS = new Set(['general', 'course topic', 'course foundations']);
const D1_MAX_BOUND_PARAMS = 100;

type CourseRow = typeof courses.$inferSelect;
type BranchRow = typeof branches.$inferSelect;
type KcRow = typeof kcs.$inferSelect;

function baselineFromCourse(course: CourseRow): TemplateBaseline | null {
  const value = course.templateBaseline;
  if (!value || typeof value !== 'object' || !('branches' in value) || !Array.isArray(value.branches)) return null;
  return value as TemplateBaseline;
}

function assertAcyclic(nodeIds: Iterable<string>, edges: Array<{ kcId: string; prereqKcId: string }>) {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.kcId) ?? [];
    list.push(edge.prereqKcId);
    adjacency.set(edge.kcId, list);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  function visit(id: string) {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      throw new ConflictError(`Prerequisites contain a cycle: ${[...path.slice(start), id].join(' → ')}`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    path.push(id);
    for (const next of adjacency.get(id) ?? []) visit(next);
    path.pop();
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of nodeIds) visit(id);
}

async function ownedGraph(db: Db, userId: string) {
  const nodes = await db
    .select({ kc: kcs, branchArchivedAt: branches.archivedAt, courseTitle: courses.title, courseSlug: courses.slug, courseTemplateId: courses.templateId })
    .from(kcs)
    .innerJoin(branches, eq(kcs.branchId, branches.id))
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(eq(courses.userId, userId), eq(courses.archived, false)));
  const ids = [...new Set(nodes.map((row) => row.kc.id))];
  const idSet = new Set(ids);
  // D1 allows at most 100 bound parameters per statement. Query outgoing
  // edges in bounded batches, then apply the second owned-node constraint in
  // memory; the old two-IN query used 2 × every KC and failed on seeded data.
  const edgeBatches = ids.length
    ? await Promise.all(
        chunk(ids, D1_MAX_BOUND_PARAMS).map((batch) =>
          db.select().from(kcEdges).where(inArray(kcEdges.kcId, batch)),
        ),
      )
    : [];
  const edges = edgeBatches.flat().filter((edge) => idSet.has(edge.prereqKcId));
  return { nodes, edges };
}

function templatePending(course: CourseRow, courseBranches: BranchRow[], courseKcs: KcRow[], decisions: Array<typeof courseTemplateDecisions.$inferSelect>) {
  if (!course.templateId) return { added: [], removed: [], dismissed: [] };
  const template = getReviewedTemplate(course.templateId);
  if (!template) return { added: [], removed: [], dismissed: [] };
  const decisionByKey = new Map(decisions.map((row) => [`${row.itemKind}:${row.templateRef}`, row]));
  const branchRefs = new Set(courseBranches.map((row) => row.templateRef).filter(Boolean));
  const kcRefs = new Set(courseKcs.map((row) => row.slug).filter(Boolean));
  const templateKcs = new Map(template.content.branches.flatMap((branch) => branch.kcs.map((kc) => [kc.slug, { branch, kc }] as const)));
  const added: Array<Record<string, unknown>> = [];
  for (const branch of template.content.branches) {
    if (!branchRefs.has(branch.slug) && !decisionByKey.has(`branch:${branch.slug}`)) {
      added.push({ item_kind: 'branch', template_ref: branch.slug, name: branch.name, kc_count: branch.kcs.length });
      continue;
    }
    for (const kc of branch.kcs) {
      if (!kcRefs.has(kc.slug) && !decisionByKey.has(`kc:${kc.slug}`)) {
        added.push({ item_kind: 'kc', template_ref: kc.slug, branch_ref: branch.slug, branch_name: branch.name, name: kc.name, kc_type: kc.kc_type, description: kc.description });
      }
    }
  }
  const removed = courseKcs
    .filter((kc) => kc.slug && !templateKcs.has(kc.slug) && !decisionByKey.has(`kc:${kc.slug}`))
    .map((kc) => ({ item_kind: 'kc' as const, template_ref: kc.slug!, id: kc.id, name: kc.name }));
  const dismissed = decisions.map((row) => ({ item_kind: row.itemKind, template_ref: row.templateRef, decision: row.decision }));
  return { added, removed, dismissed };
}

export async function getCourseMap(db: Db, userId: string, courseId: string) {
  const course = await requireOwnedCourse(db, userId, courseId);
  const [courseBranches, courseKcs, graph, decisions] = await Promise.all([
    db.select().from(branches).where(eq(branches.courseId, courseId)).orderBy(asc(branches.sortOrder)),
    db.select().from(kcs).where(eq(kcs.courseId, courseId)).orderBy(asc(kcs.sortOrder)),
    ownedGraph(db, userId),
    db.select().from(courseTemplateDecisions).where(eq(courseTemplateDecisions.courseId, courseId)),
  ]);
  const edgesByKc = new Map<string, string[]>();
  const dependentsByKc = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const prereqs = edgesByKc.get(edge.kcId) ?? [];
    prereqs.push(edge.prereqKcId);
    edgesByKc.set(edge.kcId, prereqs);
    const dependents = dependentsByKc.get(edge.prereqKcId) ?? [];
    dependents.push(edge.kcId);
    dependentsByKc.set(edge.prereqKcId, dependents);
  }
  const byBranch = new Map<string, KcRow[]>();
  for (const kc of courseKcs) {
    const list = byBranch.get(kc.branchId) ?? [];
    list.push(kc);
    byBranch.set(kc.branchId, list);
  }
  return {
    course: { id: course.id, slug: course.slug, title: course.title, mapRevision: course.mapRevision, templateId: course.templateId },
    branches: courseBranches.map((branch) => ({
      ...branch,
      archived: branch.archivedAt !== null,
      kcs: (byBranch.get(branch.id) ?? []).map((kc) => ({
        ...kc,
        archived: kc.archivedAt !== null,
        prerequisiteKcIds: edgesByKc.get(kc.id) ?? [],
        dependentKcIds: dependentsByKc.get(kc.id) ?? [],
      })),
    })),
    prerequisiteCandidates: graph.nodes
      .filter((row) => row.kc.archivedAt === null && row.branchArchivedAt === null)
      .map((row) => ({ id: row.kc.id, name: row.kc.name, courseId: row.kc.courseId, courseTitle: row.courseTitle, courseSlug: row.courseSlug })),
    templateUpdates: templatePending(course, courseBranches, courseKcs, decisions),
  };
}

export async function updateCourseMap(db: Db, userId: string, courseId: string, input: UpdateCourseMapInput) {
  const course = await requireOwnedCourse(db, userId, courseId);
  if (course.mapRevision !== input.expected_revision) throw new ConflictError('The course map changed in another tab. Reload before saving.');

  const [existingBranches, existingKcs, graph] = await Promise.all([
    db.select().from(branches).where(eq(branches.courseId, courseId)),
    db.select().from(kcs).where(eq(kcs.courseId, courseId)),
    ownedGraph(db, userId),
  ]);
  const existingBranchIds = new Set(existingBranches.map((row) => row.id));
  const existingKcIds = new Set(existingKcs.map((row) => row.id));
  const seenBranches = new Set<string>();
  const seenKcs = new Set<string>();
  const clientIds = new Map<string, string>();
  for (const branch of input.branches) {
    if (branch.id && (!existingBranchIds.has(branch.id) || seenBranches.has(branch.id))) throw new ConflictError('The submitted branches do not match this course.');
    if (branch.id) seenBranches.add(branch.id);
    else clientIds.set(branch.client_id!, crypto.randomUUID());
    for (const kc of branch.kcs) {
      if (kc.id && (!existingKcIds.has(kc.id) || seenKcs.has(kc.id))) throw new ConflictError('The submitted concepts do not match this course.');
      if (kc.id) seenKcs.add(kc.id);
      else clientIds.set(kc.client_id!, crypto.randomUUID());
    }
  }
  if (seenBranches.size !== existingBranchIds.size || seenKcs.size !== existingKcIds.size) {
    throw new ConflictError('Archive concepts instead of removing them from the saved map.');
  }

  const idFor = (value: { id?: string; client_id?: string }) => value.id ?? clientIds.get(value.client_id!)!;
  const ownedIds = new Set(graph.nodes.map((row) => row.kc.id));
  for (const id of clientIds.values()) ownedIds.add(id);
  const proposedEdges: Array<{ kcId: string; prereqKcId: string }> = [];
  const activeIds = new Set<string>();
  const namesById = new Map<string, string>();
  for (const branch of input.branches) {
    for (const kc of branch.kcs) {
      const kcId = idFor(kc);
      namesById.set(kcId, kc.name);
      if (!branch.archived && !kc.archived) activeIds.add(kcId);
      for (const prereqId of new Set(kc.prerequisite_kc_ids)) {
        if (!ownedIds.has(prereqId)) throw new ConflictError('A prerequisite is unavailable or belongs to another learner.');
        if (prereqId === kcId) throw new ConflictError('A concept cannot require itself.');
        proposedEdges.push({ kcId, prereqKcId: prereqId });
      }
    }
  }
  for (const row of graph.nodes) {
    if (row.kc.courseId !== courseId && row.kc.archivedAt === null && row.branchArchivedAt === null) activeIds.add(row.kc.id);
  }
  const outsideEdges = graph.edges.filter((edge) => !existingKcIds.has(edge.kcId));
  const nextEdges = [...outsideEdges, ...proposedEdges];
  assertAcyclic(ownedIds, nextEdges);
  for (const edge of nextEdges) {
    if (activeIds.has(edge.kcId) && !activeIds.has(edge.prereqKcId)) {
      throw new ConflictError('Archive dependent concepts before archiving one of their prerequisites.');
    }
  }
  if (![...activeIds].some((id) => !PLACEHOLDER_KCS.has((namesById.get(id) ?? graph.nodes.find((row) => row.kc.id === id)?.kc.name ?? '').trim().toLowerCase()))) {
    throw new ConflictError('Keep at least one meaningful active concept.');
  }

  const now = Date.now();
  const statements: BatchItem<'sqlite'>[] = [];
  for (const branch of input.branches) {
    const branchId = idFor(branch);
    if (branch.id) statements.push(db.update(branches).set({ name: branch.name, sortOrder: branch.sort_order, archivedAt: branch.archived ? now : null }).where(eq(branches.id, branchId)));
    else statements.push(db.insert(branches).values({ id: branchId, courseId, name: branch.name, sortOrder: branch.sort_order, archivedAt: branch.archived ? now : null, createdAt: now }));
    for (const kc of branch.kcs) {
      const kcId = idFor(kc);
      const values = { branchId, name: kc.name, kcType: kc.kc_type, description: kc.description, practiceNotes: kc.practice_notes, sortOrder: kc.sort_order, archivedAt: kc.archived ? now : null };
      if (kc.id) statements.push(db.update(kcs).set(values).where(eq(kcs.id, kcId)));
      else statements.push(db.insert(kcs).values({ id: kcId, courseId, ...values, createdAt: now }));
    }
  }
  if (existingKcIds.size) statements.push(db.delete(kcEdges).where(inArray(kcEdges.kcId, [...existingKcIds])));
  for (const edge of proposedEdges) statements.push(db.insert(kcEdges).values({ id: crypto.randomUUID(), ...edge, relation: 'prerequisite', source: 'user', createdAt: now }));
  const newlyArchivedIds = input.branches.flatMap((branch) => branch.kcs.filter((kc) => kc.archived && kc.id).map((kc) => kc.id!));
  if (newlyArchivedIds.length) statements.push(db.update(tasks).set({ dismissedAt: now }).where(and(inArray(tasks.kcId, newlyArchivedIds), isNull(tasks.dismissedAt))));
  statements.push(db.update(courses).set({ mapRevision: course.mapRevision + 1 }).where(and(eq(courses.id, courseId), eq(courses.mapRevision, course.mapRevision))));
  await runBatch(db, statements);
  return getCourseMap(db, userId, courseId);
}

function richTemplateStatements(db: Db, userId: string, courseId: string, kcId: string, template: NonNullable<ReturnType<typeof getReviewedTemplate>>, kcSlug: string, now: number): BatchItem<'sqlite'>[] {
  const authored = template.content.branches.flatMap((branch) => branch.kcs).find((kc) => kc.slug === kcSlug);
  if (!authored) return [];
  const authoredExercises = template.exercises.exercises.filter((exercise) => exercise.kc === kcSlug);
  const statements: BatchItem<'sqlite'>[] = [
    db.delete(scaffolds).where(and(eq(scaffolds.kcId, kcId), eq(scaffolds.source, 'seed'))),
    db.update(misconceptions).set({ retiredAt: now }).where(and(eq(misconceptions.kcId, kcId), eq(misconceptions.source, 'seed'))),
    db.update(exercises).set({ retiredAt: now }).where(and(eq(exercises.kcId, kcId), eq(exercises.origin, 'seed'))),
    db.delete(resources).where(and(eq(resources.userId, userId), eq(resources.courseId, courseId), eq(resources.kcId, kcId), or(eq(resources.addedBy, 'reviewed_template'), eq(resources.addedBy, 'seed')))),
  ];
  authored.scaffolds.forEach((item, index) => statements.push(db.insert(scaffolds).values({ id: crypto.randomUUID(), kcId, kind: item.kind, level: item.level, title: item.title, body: item.body, details: item.details, sortOrder: index, source: 'seed', createdAt: now })));
  authored.misconceptions.forEach((item) => statements.push(db.insert(misconceptions).values({ id: crypto.randomUUID(), kcId, slug: item.slug, name: item.name, description: item.description, rootCause: item.root_cause, diagnosticProbe: item.diagnostic_probe, correction: item.correction, source: 'seed', retiredAt: null, createdAt: now }).onConflictDoUpdate({ target: [misconceptions.kcId, misconceptions.slug], set: { name: item.name, description: item.description, rootCause: item.root_cause, diagnosticProbe: item.diagnostic_probe, correction: item.correction, retiredAt: null } })));
  authoredExercises.forEach((item, index) => statements.push(db.insert(exercises).values({ id: crypto.randomUUID(), kcId, slug: item.slug, kind: item.kind, difficulty: item.difficulty, prompt: item.prompt, details: exerciseDetails(item), source: item.source, origin: 'seed', sortOrder: index, retiredAt: null, createdAt: now }).onConflictDoUpdate({ target: [exercises.kcId, exercises.slug], set: { kind: item.kind, difficulty: item.difficulty, prompt: item.prompt, details: exerciseDetails(item), source: item.source, origin: 'seed', sortOrder: index, retiredAt: null } })));
  authored.resources.forEach((item) => statements.push(db.insert(resources).values({ id: crypto.randomUUID(), userId, courseId, kcId, url: item.url, label: item.label, kind: item.kind, pinned: item.pinned, addedBy: 'reviewed_template', createdAt: now })));
  return statements;
}

export async function syncReviewedTemplateContent(db: Db, userId: string, courseId: string) {
  const course = await requireOwnedCourse(db, userId, courseId);
  if (!course.templateId) return false;
  const template = getReviewedTemplate(course.templateId);
  const revision = await getReviewedTemplateRevision(course.templateId);
  const currentBaseline = getTemplateBaseline(course.templateId);
  if (!template || !revision || !currentBaseline || course.templateRevision === revision) return false;
  const [courseBranches, courseKcs, graph] = await Promise.all([
    db.select().from(branches).where(eq(branches.courseId, courseId)),
    db.select().from(kcs).where(eq(kcs.courseId, courseId)),
    ownedGraph(db, userId),
  ]);
  const previous = baselineFromCourse(course);
  const oldBranchByRef = new Map(previous?.branches.map((branch) => [branch.ref, branch]) ?? []);
  const currentBranchByRef = new Map(currentBaseline.branches.map((branch) => [branch.ref, branch]));
  const currentKcByRef = new Map(currentBaseline.branches.flatMap((branch) => branch.kcs.map((kc) => [kc.ref, kc] as const)));
  const now = Date.now();
  const statements: BatchItem<'sqlite'>[] = [
    db.delete(resources).where(and(eq(resources.userId, userId), eq(resources.courseId, courseId), isNull(resources.kcId), or(eq(resources.addedBy, 'reviewed_template'), eq(resources.addedBy, 'seed')))),
  ];
  for (const item of template.content.course_resources) {
    statements.push(db.insert(resources).values({ id: crypto.randomUUID(), userId, courseId, kcId: null, url: item.url, label: item.label, kind: item.kind, pinned: item.pinned, addedBy: 'reviewed_template', createdAt: now }));
  }
  let mapChanged = false;
  for (const branch of courseBranches) {
    let ref = branch.templateRef;
    if (!ref) {
      const slugs = courseKcs.filter((kc) => kc.branchId === branch.id && kc.slug).map((kc) => kc.slug!);
      ref = currentBaseline.branches.find((candidate) => candidate.kcs.some((kc) => slugs.includes(kc.ref)))?.ref ?? null;
      if (ref) statements.push(db.update(branches).set({ templateRef: ref }).where(eq(branches.id, branch.id)));
    }
    const old = ref ? oldBranchByRef.get(ref) : undefined;
    const next = ref ? currentBranchByRef.get(ref) : undefined;
    const patch: Partial<typeof branches.$inferInsert> = {};
    if (old && next && branch.name === old.name && branch.name !== next.name) patch.name = next.name;
    if (old && next && branch.sortOrder === old.sort_order && branch.sortOrder !== next.sort_order) patch.sortOrder = next.sort_order;
    if (Object.keys(patch).length) { statements.push(db.update(branches).set(patch).where(eq(branches.id, branch.id))); mapChanged = true; }
  }
  const oldKcByRef = new Map(previous?.branches.flatMap((branch) => branch.kcs.map((kc) => [kc.ref, kc] as const)) ?? []);
  const graphKeyById = new Map(graph.nodes.filter((row) => row.kc.slug).map((row) => [`${row.kc.id}`, `${row.courseTemplateId ?? row.courseSlug}#${row.kc.slug}`]));
  const graphIdByKey = new Map([...graphKeyById].map(([id, key]) => [key, id]));
  const nextGraphEdges = graph.edges.map((edge) => ({ kcId: edge.kcId, prereqKcId: edge.prereqKcId }));
  const prerequisiteReplacements = new Map<string, string[]>();
  for (const kc of courseKcs) {
    if (!kc.slug) continue;
    const old = oldKcByRef.get(kc.slug);
    const next = currentKcByRef.get(kc.slug);
    if (next && old) {
      const patch: Partial<typeof kcs.$inferInsert> = {};
      if (kc.name === old.name && kc.name !== next.name) patch.name = next.name;
      if (kc.kcType === old.kc_type && kc.kcType !== next.kc_type) patch.kcType = next.kc_type as KcRow['kcType'];
      if ((kc.description ?? '') === old.description && (kc.description ?? '') !== next.description) patch.description = next.description;
      if ((kc.practiceNotes ?? '') === old.practice_notes && (kc.practiceNotes ?? '') !== next.practice_notes) patch.practiceNotes = next.practice_notes;
      if (kc.sortOrder === old.sort_order && kc.sortOrder !== next.sort_order) patch.sortOrder = next.sort_order;
      if (Object.keys(patch).length) { statements.push(db.update(kcs).set(patch).where(eq(kcs.id, kc.id))); mapChanged = true; }
      const currentKeys = nextGraphEdges.filter((edge) => edge.kcId === kc.id).map((edge) => graphKeyById.get(edge.prereqKcId)).filter((key): key is string => Boolean(key)).sort();
      const oldKeys = old.prereq_refs.map((ref) => parseKcRef(ref, course.templateId!).key).sort();
      const nextKeys = next.prereq_refs.map((ref) => parseKcRef(ref, course.templateId!).key);
      const nextIds = nextKeys.map((key) => graphIdByKey.get(key));
      if (JSON.stringify(currentKeys) === JSON.stringify(oldKeys) && nextIds.every((id): id is string => Boolean(id))) {
        prerequisiteReplacements.set(kc.id, nextIds);
      }
    }
    if (next) statements.push(...richTemplateStatements(db, userId, courseId, kc.id, template, kc.slug, now));
  }
  if (prerequisiteReplacements.size) {
    const replacementTargets = new Set(prerequisiteReplacements.keys());
    const retained = nextGraphEdges.filter((edge) => !replacementTargets.has(edge.kcId));
    const replacementEdges = [...prerequisiteReplacements].flatMap(([kcId, prereqIds]) => prereqIds.map((prereqKcId) => ({ kcId, prereqKcId })));
    assertAcyclic(graph.nodes.map((row) => row.kc.id), [...retained, ...replacementEdges]);
    for (const [kcId, prereqIds] of prerequisiteReplacements) {
      statements.push(db.delete(kcEdges).where(eq(kcEdges.kcId, kcId)));
      for (const prereqKcId of prereqIds) statements.push(db.insert(kcEdges).values({ id: crypto.randomUUID(), kcId, prereqKcId, relation: 'prerequisite', source: 'seed', createdAt: now }));
    }
    mapChanged = true;
  }
  statements.push(db.update(courses).set({ templateRevision: revision, templateBaseline: currentBaseline, templateSyncedAt: now, ...(mapChanged ? { mapRevision: course.mapRevision + 1 } : {}) }).where(eq(courses.id, courseId)));
  await runBatch(db, statements);
  return true;
}

export async function applyTemplateUpdateActions(db: Db, userId: string, courseId: string, input: ApplyTemplateUpdatesInput) {
  const course = await requireOwnedCourse(db, userId, courseId);
  if (course.mapRevision !== input.expected_revision) throw new ConflictError('The course map changed in another tab. Reload before continuing.');
  if (!course.templateId) throw new ConflictError('This course is not linked to a reviewed template.');
  const template = getReviewedTemplate(course.templateId);
  const revision = await getReviewedTemplateRevision(course.templateId);
  if (!template || !revision) throw new ConflictError('This reviewed template is unavailable.');
  const [courseBranches, courseKcs, graph] = await Promise.all([
    db.select().from(branches).where(eq(branches.courseId, courseId)),
    db.select().from(kcs).where(eq(kcs.courseId, courseId)),
    ownedGraph(db, userId),
  ]);
  const branchByRef = new Map(courseBranches.filter((row) => row.templateRef).map((row) => [row.templateRef!, row]));
  const kcByRef = new Map(courseKcs.filter((row) => row.slug).map((row) => [row.slug!, row]));
  const now = Date.now();
  const statements: BatchItem<'sqlite'>[] = [];
  let structural = false;
  const includedRefs = new Set<string>();
  const includeKc = (ref: string) => {
    if (kcByRef.has(ref)) return;
    const authoredBranch = template.content.branches.find((branch) => branch.kcs.some((kc) => kc.slug === ref));
    const authored = authoredBranch?.kcs.find((kc) => kc.slug === ref);
    if (!authoredBranch || !authored) throw new ConflictError('That template concept is no longer available.');
    for (const prereqRef of authored.prereqs) {
      const parsed = parseKcRef(prereqRef, course.templateId!);
      if (parsed.courseSlug === course.templateId) includeKc(parsed.kcSlug);
    }
    let branch = branchByRef.get(authoredBranch.slug);
    if (!branch) {
      branch = { id: crypto.randomUUID(), courseId, name: authoredBranch.name, templateRef: authoredBranch.slug, sortOrder: authoredBranch.sort_order, archivedAt: null, createdAt: now };
      branchByRef.set(authoredBranch.slug, branch);
      statements.push(db.insert(branches).values(branch));
    }
    const kcId = crypto.randomUUID();
    const row = { id: kcId, branchId: branch.id, courseId, name: authored.name, kcType: authored.kc_type, description: authored.description, practiceNotes: authored.practice_notes, slug: authored.slug, sortOrder: authored.sort_order, archivedAt: null, mastery: 0, status: 'not-started', lastEventAt: null, createdAt: now } satisfies KcRow;
    kcByRef.set(ref, row);
    includedRefs.add(ref);
    statements.push(db.insert(kcs).values(row));
    statements.push(...richTemplateStatements(db, userId, courseId, kcId, template, ref, now));
    structural = true;
  };
  for (const action of input.actions) {
    if (action.action === 'dismiss' || action.action === 'keep') {
      statements.push(db.insert(courseTemplateDecisions).values({ id: crypto.randomUUID(), courseId, itemKind: action.item_kind, templateRef: action.template_ref, decision: action.action === 'dismiss' ? 'dismissed' : 'kept', templateRevision: revision, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [courseTemplateDecisions.courseId, courseTemplateDecisions.itemKind, courseTemplateDecisions.templateRef], set: { decision: action.action === 'dismiss' ? 'dismissed' : 'kept', templateRevision: revision, updatedAt: now } }));
    } else if (action.action === 'include') {
      if (action.item_kind === 'branch') {
        const authored = template.content.branches.find((branch) => branch.slug === action.template_ref);
        if (!authored) throw new ConflictError('That template branch is no longer available.');
        for (const kc of authored.kcs) includeKc(kc.slug);
      } else includeKc(action.template_ref);
      statements.push(db.delete(courseTemplateDecisions).where(and(eq(courseTemplateDecisions.courseId, courseId), eq(courseTemplateDecisions.itemKind, action.item_kind), eq(courseTemplateDecisions.templateRef, action.template_ref))));
    } else {
      const kc = kcByRef.get(action.template_ref);
      if (!kc) throw new ConflictError('That concept is no longer in this course.');
      const activeNodeIds = new Set(graph.nodes.filter((row) => row.kc.archivedAt === null && row.branchArchivedAt === null).map((row) => row.kc.id));
      if (graph.edges.some((edge) => edge.prereqKcId === kc.id && activeNodeIds.has(edge.kcId))) {
        throw new ConflictError('Archive dependent concepts before archiving this prerequisite.');
      }
      const meaningfulRemaining = graph.nodes.filter((row) => row.kc.id !== kc.id && row.kc.archivedAt === null && row.branchArchivedAt === null && !PLACEHOLDER_KCS.has(row.kc.name.trim().toLowerCase()));
      if (meaningfulRemaining.length === 0) throw new ConflictError('Keep at least one meaningful active concept.');
      statements.push(db.update(kcs).set({ archivedAt: now }).where(eq(kcs.id, kc.id)));
      statements.push(db.insert(courseTemplateDecisions).values({ id: crypto.randomUUID(), courseId, itemKind: 'kc', templateRef: action.template_ref, decision: 'dismissed', templateRevision: revision, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [courseTemplateDecisions.courseId, courseTemplateDecisions.itemKind, courseTemplateDecisions.templateRef], set: { decision: 'dismissed', templateRevision: revision, updatedAt: now } }));
      structural = true;
    }
  }
  const graphIdByKey = new Map(graph.nodes.filter((row) => row.kc.slug).map((row) => [`${row.courseTemplateId ?? row.courseSlug}#${row.kc.slug}`, row.kc.id]));
  for (const ref of includedRefs) {
    const authored = template.content.branches.flatMap((branch) => branch.kcs).find((kc) => kc.slug === ref)!;
    const targetId = kcByRef.get(ref)!.id;
    for (const prereqRef of authored.prereqs) {
      const parsed = parseKcRef(prereqRef, course.templateId);
      const prereqId = parsed.courseSlug === course.templateId ? kcByRef.get(parsed.kcSlug)?.id : graphIdByKey.get(parsed.key);
      if (prereqId) statements.push(db.insert(kcEdges).values({ id: crypto.randomUUID(), kcId: targetId, prereqKcId: prereqId, relation: 'prerequisite', source: 'seed', createdAt: now }).onConflictDoNothing());
    }
  }
  if (structural) statements.push(db.update(courses).set({ mapRevision: course.mapRevision + 1 }).where(and(eq(courses.id, courseId), eq(courses.mapRevision, course.mapRevision))));
  await runBatch(db, statements);
  return getCourseMap(db, userId, courseId);
}
