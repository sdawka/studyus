import { asc, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import {
  branches,
  courseModules,
  courseOutcomes,
  courseReferences,
  courses,
  exampleKcs,
  experienceKcs,
  experienceMisconceptions,
  experiences,
  exercises,
  kcEdges,
  kcExamples,
  kcs,
  misconceptionKcs,
  misconceptions,
  moduleExperiences,
  moduleKcs,
  moduleOutcomes,
  outcomeKcs,
  referenceExamples,
  referenceExperiences,
  referenceKcs,
  referenceMisconceptions,
  scaffolds,
} from '../../db/schema';
import { validateCourseDraft } from '../domain/courseDraft';
import type { CourseDraftV2 } from '../schemas/courseDraft';
import { courseSlugAllocator } from './courses';
import { requireOwnedCourse, runBatch } from './util';

export type PersistCourseDraftOptions = {
  sourceTemplateKey?: string;
  sourceTemplateVersion?: string;
  bootstrapKey?: string;
};

const legacyKcType = {
  constant_constant: 'fact',
  variable_constant: 'concept',
  variable_variable: 'principle',
} as const;

export class CourseDomainVersionError extends Error {
  constructor() {
    super('Course domain version is not supported');
    this.name = 'CourseDomainVersionError';
  }
}

function contentRecord(content: unknown): Record<string, unknown> {
  return content && typeof content === 'object' && !Array.isArray(content) ? content as Record<string, unknown> : {};
}

function safeString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

function browserSafeSelectionPolicy(content: Record<string, unknown>) {
  const policy = contentRecord(content.selection_policy);
  const tags = safeStrings(policy.evidence_tags)?.filter((tag) => ['spacing', 'retention', 'transfer'].includes(tag));
  return tags ? { selection_policy: { evidence_tags: tags } } : {};
}

function browserSafeExampleContent(value: unknown): unknown {
  const content = contentRecord(value);
  if (content.schema_version !== 1) return {};
  if (content.kind === 'text') {
    return { schema_version: 1, kind: 'text', ...(safeString(content.body) === undefined ? {} : { body: content.body }) };
  }
  if (content.kind === 'contrast') {
    return {
      schema_version: 1,
      kind: 'contrast',
      ...(safeString(content.positive) === undefined ? {} : { positive: content.positive }),
      ...(safeString(content.negative) === undefined ? {} : { negative: content.negative }),
    };
  }
  if (content.kind === 'generic') return { schema_version: 1, kind: 'generic', data: {} };
  return {};
}

function browserSafeExperienceContent(value: unknown): unknown {
  const content = contentRecord(value);
  if (content.schema_version !== 1) return {};
  if (content.kind === 'scaffold') {
    return {
      schema_version: 1,
      kind: 'scaffold',
      ...browserSafeSelectionPolicy(content),
      ...(safeString(content.scaffold_kind) === undefined ? {} : { scaffold_kind: content.scaffold_kind }),
      ...(safeNumber(content.level) === undefined ? {} : { level: content.level }),
      ...(safeString(content.title) === undefined ? {} : { title: content.title }),
      ...(safeString(content.body) === undefined ? {} : { body: content.body }),
    };
  }
  if (content.kind === 'mcq') {
    return {
      schema_version: 1,
      kind: 'mcq',
      ...browserSafeSelectionPolicy(content),
      ...(safeString(content.prompt) === undefined ? {} : { prompt: content.prompt }),
      ...(safeStrings(content.options) === undefined ? {} : { options: content.options }),
      ...(safeNumber(content.difficulty) === undefined ? {} : { difficulty: content.difficulty }),
      ...(safeString(content.source) === undefined ? {} : { source: content.source }),
    };
  }
  if (content.kind === 'numeric' || content.kind === 'worked') {
    return {
      schema_version: 1,
      kind: content.kind,
      ...browserSafeSelectionPolicy(content),
      ...(safeString(content.prompt) === undefined ? {} : { prompt: content.prompt }),
      ...(safeNumber(content.difficulty) === undefined ? {} : { difficulty: content.difficulty }),
      ...(safeString(content.source) === undefined ? {} : { source: content.source }),
    };
  }
  if (content.kind === 'project') {
    return {
      schema_version: 1,
      kind: 'project',
      ...browserSafeSelectionPolicy(content),
      ...(safeString(content.title) === undefined ? {} : { title: content.title }),
      ...(safeString(content.brief) === undefined ? {} : { brief: content.brief }),
      ...(safeString(content.deliverable) === undefined ? {} : { deliverable: content.deliverable }),
      ...(safeStrings(content.rubric) === undefined ? {} : { rubric: content.rubric }),
    };
  }
  return {};
}

function browserSafeScoringDetails(kind: string, value: unknown): unknown {
  const details = contentRecord(value);
  if (details.schema_version !== 1) return {};
  if (kind === 'binary' || kind === 'numeric') return { schema_version: 1 };
  if (kind !== 'rubric' || !Array.isArray(details.criteria)) return {};
  return {
    schema_version: 1,
    criteria: details.criteria.map((value) => {
      const criterion = contentRecord(value);
      return {
        ...(safeString(criterion.id) === undefined ? {} : { id: criterion.id }),
        ...(safeString(criterion.label) === undefined ? {} : { label: criterion.label }),
        ...(safeString(criterion.description) === undefined ? {} : { description: criterion.description }),
        ...(safeNumber(criterion.max_points) === undefined ? {} : { max_points: criterion.max_points }),
      };
    }),
  };
}

function textValue(content: Record<string, unknown>, key: string, fallback: string): string {
  const value = content[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function intValue(content: Record<string, unknown>, key: string, fallback: number): number {
  const value = content[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
}

function ids<T extends { id: string }>(records: T[]): Map<string, string> {
  return new Map(records.map((record) => [record.id, crypto.randomUUID()]));
}

function mapped(map: Map<string, string>, draftId: string): string {
  const value = map.get(draftId);
  if (!value) throw new Error(`Validated course draft lost ID mapping for ${draftId}`);
  return value;
}

function exerciseKind(value: unknown): 'mcq' | 'numeric' | 'worked' {
  return value === 'mcq' || value === 'numeric' || value === 'worked' ? value : 'worked';
}

function scaffoldKind(value: unknown): typeof scaffolds.$inferInsert.kind {
  const allowed = new Set([
    'retrieval_prompt', 'mnemonic', 'matching_drill', 'classification_task', 'contrast_examples', 'worked_example',
    'procedure_outline', 'self_explanation_prompt', 'derivation_walkthrough', 'interactive_model', 'analogy',
  ]);
  return typeof value === 'string' && allowed.has(value) ? value as typeof scaffolds.$inferInsert.kind : 'worked_example';
}

export type CourseDraftBatch = {
  statements: BatchItem<'sqlite'>[];
  courseId: string;
  slug: string;
};

/** Validates and builds the statements for one complete learner-owned course aggregate. */
export async function buildCourseDraftStatements(
  db: Db,
  userId: string,
  input: CourseDraftV2,
  options: PersistCourseDraftOptions = {},
): Promise<CourseDraftBatch> {
  const draft = validateCourseDraft(input);
  const allocateSlug = await courseSlugAllocator(db, userId);
  const courseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  const slug = allocateSlug(draft.spec.title);
  const outcomeIds = ids(draft.outcomes);
  const kcIds = ids(draft.kcs);
  const exampleIds = ids(draft.examples);
  const misconceptionIds = ids(draft.misconceptions);
  const experienceIds = ids(draft.experiences);
  const referenceIds = ids(draft.references);
  const moduleIds = ids(draft.modules);
  const statements: BatchItem<'sqlite'>[] = [];

  statements.push(db.insert(courses).values({
    id: courseId,
    userId,
    code: draft.spec.title,
    slug,
    title: draft.spec.title,
    overview: draft.spec.topic,
    topic: draft.spec.topic,
    level: draft.spec.level,
    project: draft.spec.project,
    constraints: draft.spec.constraints,
    sourceTemplateKey: options.sourceTemplateKey,
    sourceTemplateVersion: options.sourceTemplateVersion,
    bootstrapKey: options.bootstrapKey,
    domainVersion: 2,
  }));
  statements.push(db.insert(branches).values({ id: branchId, courseId, name: 'General', sortOrder: 0 }));

  draft.kcs.forEach((kc, sortOrder) => {
    statements.push(db.insert(kcs).values({
      id: mapped(kcIds, kc.id),
      branchId,
      courseId,
      name: kc.name,
      description: kc.description,
      kcType: legacyKcType[kc.kc_form],
      kcForm: kc.kc_form,
      rationaleLevel: kc.rationale_level,
      masteryRule: kc.mastery_rule,
      sortOrder,
    }));
  });
  draft.kcs.forEach((kc) => kc.prerequisite_kc_ids.forEach((prerequisiteId) => {
    statements.push(db.insert(kcEdges).values({
      id: crypto.randomUUID(),
      kcId: mapped(kcIds, kc.id),
      prereqKcId: mapped(kcIds, prerequisiteId),
      source: 'seed',
    }));
  }));

  draft.outcomes.forEach((outcome, sortOrder) => {
    const outcomeId = mapped(outcomeIds, outcome.id);
    statements.push(db.insert(courseOutcomes).values({ id: outcomeId, courseId, title: outcome.title, description: outcome.description, sortOrder }));
    outcome.kc_ids.forEach((kcId, linkOrder) => statements.push(db.insert(outcomeKcs).values({
      outcomeId, kcId: mapped(kcIds, kcId), courseId, sortOrder: linkOrder,
    })));
  });

  draft.examples.forEach((example, sortOrder) => {
    const exampleId = mapped(exampleIds, example.id);
    statements.push(db.insert(kcExamples).values({ id: exampleId, courseId, content: example.content, sortOrder }));
    example.kc_ids.forEach((kcId, linkOrder) => statements.push(db.insert(exampleKcs).values({
      exampleId, kcId: mapped(kcIds, kcId), courseId, sortOrder: linkOrder,
    })));
  });

  draft.misconceptions.forEach((misconception, sortOrder) => {
    const misconceptionId = mapped(misconceptionIds, misconception.id);
    statements.push(db.insert(misconceptions).values({
      id: misconceptionId,
      courseId,
      kcId: mapped(kcIds, misconception.kc_ids[0]),
      slug: `draft-${sortOrder + 1}-${misconceptionId.slice(0, 8)}`,
      name: misconception.name,
      description: misconception.name,
      rootCause: misconception.name,
      diagnosticProbe: misconception.diagnostic_probe,
      correction: misconception.correction,
      source: 'seed',
    }));
    misconception.kc_ids.forEach((kcId, linkOrder) => statements.push(db.insert(misconceptionKcs).values({
      misconceptionId, kcId: mapped(kcIds, kcId), courseId, sortOrder: linkOrder,
    })));
  });

  draft.experiences.forEach((experience, sortOrder) => {
    const experienceId = mapped(experienceIds, experience.id);
    statements.push(db.insert(experiences).values({
      id: experienceId,
      courseId,
      kind: experience.kind,
      intendedProcesses: experience.intended_processes,
      content: experience.content,
      evidenceResponseType: experience.evidence?.response_type,
      evidenceScoringKind: experience.evidence?.scoring?.kind,
      evidenceScoringDetails: experience.evidence?.scoring?.details,
      sortOrder,
    }));
    const evidenceTargets = new Set(experience.evidence?.target_kc_ids ?? []);
    experience.target_kc_ids.forEach((kcId, linkOrder) => statements.push(db.insert(experienceKcs).values({
      experienceId,
      kcId: mapped(kcIds, kcId),
      courseId,
      isEvidenceTarget: evidenceTargets.has(kcId),
      sortOrder: linkOrder,
    })));
    experience.evidence?.diagnostic_misconception_ids.forEach((misconceptionId, linkOrder) => {
      statements.push(db.insert(experienceMisconceptions).values({
        experienceId,
        misconceptionId: mapped(misconceptionIds, misconceptionId),
        courseId,
        sortOrder: linkOrder,
      }));
    });

    const content = contentRecord(experience.content);
    const primaryKcId = mapped(kcIds, experience.target_kc_ids[0]);
    if (experience.kind === 'scaffold') {
      statements.push(db.insert(scaffolds).values({
        id: crypto.randomUUID(),
        experienceId,
        kcId: primaryKcId,
        kind: scaffoldKind(content.scaffold_kind),
        level: intValue(content, 'level', 1),
        title: textValue(content, 'title', `Learning experience ${sortOrder + 1}`),
        body: textValue(content, 'body', JSON.stringify(experience.content)),
        details: content.details ?? experience.content,
        sortOrder,
        source: 'user',
      }));
    } else if (experience.kind === 'exercise') {
      statements.push(db.insert(exercises).values({
        id: crypto.randomUUID(),
        experienceId,
        kcId: primaryKcId,
        slug: `draft-experience-${sortOrder + 1}`,
        kind: exerciseKind(content.kind),
        difficulty: intValue(content, 'difficulty', 2),
        prompt: textValue(content, 'prompt', `Learning experience ${sortOrder + 1}`),
        details: content.details ?? experience.content,
        source: textValue(content, 'source', 'Course draft'),
        origin: 'user',
        sortOrder,
      }));
    }
  });

  draft.references.forEach((reference, sortOrder) => {
    const referenceId = mapped(referenceIds, reference.id);
    statements.push(db.insert(courseReferences).values({
      id: referenceId, courseId, citation: reference.citation, url: reference.url, sortOrder,
    }));
    reference.kc_ids.forEach((kcId) => statements.push(db.insert(referenceKcs).values({ referenceId, kcId: mapped(kcIds, kcId), courseId })));
    reference.example_ids.forEach((exampleId) => statements.push(db.insert(referenceExamples).values({ referenceId, exampleId: mapped(exampleIds, exampleId), courseId })));
    reference.experience_ids.forEach((experienceId) => statements.push(db.insert(referenceExperiences).values({ referenceId, experienceId: mapped(experienceIds, experienceId), courseId })));
    reference.misconception_ids.forEach((misconceptionId) => statements.push(db.insert(referenceMisconceptions).values({
      referenceId, misconceptionId: mapped(misconceptionIds, misconceptionId), courseId,
    })));
  });

  draft.modules.forEach((module) => {
    const moduleId = mapped(moduleIds, module.id);
    statements.push(db.insert(courseModules).values({ id: moduleId, courseId, title: module.title, sortOrder: module.sort_order }));
    module.outcome_ids.forEach((outcomeId, sortOrder) => statements.push(db.insert(moduleOutcomes).values({
      moduleId, outcomeId: mapped(outcomeIds, outcomeId), courseId, sortOrder,
    })));
    module.kc_ids.forEach((kcId, sortOrder) => statements.push(db.insert(moduleKcs).values({
      moduleId, kcId: mapped(kcIds, kcId), courseId, sortOrder,
    })));
    module.experience_ids.forEach((experienceId, sortOrder) => statements.push(db.insert(moduleExperiences).values({
      moduleId, experienceId: mapped(experienceIds, experienceId), courseId, sortOrder,
    })));
  });

  return { statements, courseId, slug };
}

/** Validates and atomically deep-copies one complete learner-owned course aggregate. */
export async function persistCourseDraft(
  db: Db,
  userId: string,
  input: CourseDraftV2,
  options: PersistCourseDraftOptions = {},
): Promise<{ courseId: string; slug: string }> {
  const batch = await buildCourseDraftStatements(db, userId, input, options);
  await runBatch(db, batch.statements);
  return { courseId: batch.courseId, slug: batch.slug };
}

/** Returns an owner-scoped, browser-safe draft-shaped view with database IDs. */
export async function getCourseDomain(db: Db, userId: string, courseId: string) {
  const course = await requireOwnedCourse(db, userId, courseId);
  if (course.domainVersion !== 2) throw new CourseDomainVersionError();
  const [outcomeRows, kcRows, edgeRows, exampleRows, exampleLinkRows, misconceptionRows, misconceptionLinkRows,
    experienceRows, experienceLinkRows, diagnosticRows, referenceRows, referenceKcRows, referenceExampleRows,
    referenceExperienceRows, referenceMisconceptionRows, moduleRows, moduleOutcomeRows, moduleKcRows, moduleExperienceRows] = await Promise.all([
    db.select().from(courseOutcomes).where(eq(courseOutcomes.courseId, courseId)).orderBy(asc(courseOutcomes.sortOrder)),
    db.select().from(kcs).where(eq(kcs.courseId, courseId)).orderBy(asc(kcs.sortOrder)),
    db.select({ kcId: kcEdges.kcId, prereqKcId: kcEdges.prereqKcId }).from(kcEdges).innerJoin(kcs, eq(kcEdges.kcId, kcs.id)).where(eq(kcs.courseId, courseId)),
    db.select().from(kcExamples).where(eq(kcExamples.courseId, courseId)).orderBy(asc(kcExamples.sortOrder)),
    db.select({ exampleId: exampleKcs.exampleId, kcId: exampleKcs.kcId, sortOrder: exampleKcs.sortOrder }).from(exampleKcs).innerJoin(kcExamples, eq(exampleKcs.exampleId, kcExamples.id)).where(eq(kcExamples.courseId, courseId)),
    db.select().from(misconceptions).innerJoin(kcs, eq(misconceptions.kcId, kcs.id)).where(eq(kcs.courseId, courseId)).then((rows) => rows.map((row) => row.misconceptions)),
    db.select({ misconceptionId: misconceptionKcs.misconceptionId, kcId: misconceptionKcs.kcId, sortOrder: misconceptionKcs.sortOrder }).from(misconceptionKcs).innerJoin(kcs, eq(misconceptionKcs.kcId, kcs.id)).where(eq(kcs.courseId, courseId)),
    db.select().from(experiences).where(eq(experiences.courseId, courseId)).orderBy(asc(experiences.sortOrder)),
    db.select({ experienceId: experienceKcs.experienceId, kcId: experienceKcs.kcId, isEvidenceTarget: experienceKcs.isEvidenceTarget, sortOrder: experienceKcs.sortOrder }).from(experienceKcs).innerJoin(experiences, eq(experienceKcs.experienceId, experiences.id)).where(eq(experiences.courseId, courseId)),
    db.select({ experienceId: experienceMisconceptions.experienceId, misconceptionId: experienceMisconceptions.misconceptionId, sortOrder: experienceMisconceptions.sortOrder }).from(experienceMisconceptions).innerJoin(experiences, eq(experienceMisconceptions.experienceId, experiences.id)).where(eq(experiences.courseId, courseId)),
    db.select().from(courseReferences).where(eq(courseReferences.courseId, courseId)).orderBy(asc(courseReferences.sortOrder)),
    db.select().from(referenceKcs).innerJoin(courseReferences, eq(referenceKcs.referenceId, courseReferences.id)).where(eq(courseReferences.courseId, courseId)).then((rows) => rows.map((row) => row.reference_kcs)),
    db.select().from(referenceExamples).innerJoin(courseReferences, eq(referenceExamples.referenceId, courseReferences.id)).where(eq(courseReferences.courseId, courseId)).then((rows) => rows.map((row) => row.reference_examples)),
    db.select().from(referenceExperiences).innerJoin(courseReferences, eq(referenceExperiences.referenceId, courseReferences.id)).where(eq(courseReferences.courseId, courseId)).then((rows) => rows.map((row) => row.reference_experiences)),
    db.select().from(referenceMisconceptions).innerJoin(courseReferences, eq(referenceMisconceptions.referenceId, courseReferences.id)).where(eq(courseReferences.courseId, courseId)).then((rows) => rows.map((row) => row.reference_misconceptions)),
    db.select().from(courseModules).where(eq(courseModules.courseId, courseId)).orderBy(asc(courseModules.sortOrder)),
    db.select().from(moduleOutcomes).innerJoin(courseModules, eq(moduleOutcomes.moduleId, courseModules.id)).where(eq(courseModules.courseId, courseId)).then((rows) => rows.map((row) => row.module_outcomes)),
    db.select().from(moduleKcs).innerJoin(courseModules, eq(moduleKcs.moduleId, courseModules.id)).where(eq(courseModules.courseId, courseId)).then((rows) => rows.map((row) => row.module_kcs)),
    db.select().from(moduleExperiences).innerJoin(courseModules, eq(moduleExperiences.moduleId, courseModules.id)).where(eq(courseModules.courseId, courseId)).then((rows) => rows.map((row) => row.module_experiences)),
  ]);

  const by = <T extends Record<string, unknown>>(rows: T[], key: keyof T) => (id: string) => rows.filter((row) => row[key] === id);
  const outcomeLinks = await db.select({ outcomeId: outcomeKcs.outcomeId, kcId: outcomeKcs.kcId, sortOrder: outcomeKcs.sortOrder })
    .from(outcomeKcs).innerJoin(courseOutcomes, eq(outcomeKcs.outcomeId, courseOutcomes.id)).where(eq(courseOutcomes.courseId, courseId));

  return {
    schema_version: 2 as const,
    spec: {
      title: course.title,
      topic: course.topic ?? course.overview ?? course.title,
      level: course.level ?? 'unspecified',
      ...(course.project ? { project: course.project } : {}),
      constraints: course.constraints,
    },
    outcomes: outcomeRows.map((outcome) => ({
      id: outcome.id,
      title: outcome.title,
      ...(outcome.description ? { description: outcome.description } : {}),
      kc_ids: by(outcomeLinks, 'outcomeId')(outcome.id).sort((a, b) => a.sortOrder - b.sortOrder).map((link) => link.kcId),
    })),
    kcs: kcRows.map((kc) => ({
      id: kc.id,
      name: kc.name,
      ...(kc.description ? { description: kc.description } : {}),
      kc_form: kc.kcForm!,
      rationale_level: kc.rationaleLevel!,
      mastery_rule: kc.masteryRule,
      prerequisite_kc_ids: edgeRows.filter((edge) => edge.kcId === kc.id).map((edge) => edge.prereqKcId),
    })),
    examples: exampleRows.map((example) => ({
      id: example.id,
      kc_ids: by(exampleLinkRows, 'exampleId')(example.id).sort((a, b) => a.sortOrder - b.sortOrder).map((link) => link.kcId),
      content: browserSafeExampleContent(example.content),
    })),
    misconceptions: misconceptionRows.map((misconception) => ({
      id: misconception.id,
      kc_ids: by(misconceptionLinkRows, 'misconceptionId')(misconception.id).sort((a, b) => a.sortOrder - b.sortOrder).map((link) => link.kcId),
      name: misconception.name,
      diagnostic_probe: misconception.diagnosticProbe,
      correction: misconception.correction,
    })),
    experiences: experienceRows.map((experience) => {
      const targets = by(experienceLinkRows, 'experienceId')(experience.id).sort((a, b) => a.sortOrder - b.sortOrder);
      const evidenceTargets = targets.filter((target) => target.isEvidenceTarget).map((target) => target.kcId);
      return {
        id: experience.id,
        kind: experience.kind,
        target_kc_ids: targets.map((target) => target.kcId),
        intended_processes: experience.intendedProcesses,
        ...(experience.evidenceResponseType ? {
          evidence: {
            response_type: experience.evidenceResponseType,
            target_kc_ids: evidenceTargets,
            diagnostic_misconception_ids: by(diagnosticRows, 'experienceId')(experience.id).sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.misconceptionId),
            ...(experience.evidenceScoringKind ? {
              scoring: {
                kind: experience.evidenceScoringKind,
                ...(experience.evidenceScoringDetails === null ? {} : {
                  details: browserSafeScoringDetails(experience.evidenceScoringKind, experience.evidenceScoringDetails),
                }),
              },
            } : {}),
          },
        } : {}),
        content: browserSafeExperienceContent(experience.content),
      };
    }),
    references: referenceRows.map((reference) => ({
      id: reference.id,
      citation: reference.citation,
      ...(reference.url ? { url: reference.url } : {}),
      kc_ids: referenceKcRows.filter((row) => row.referenceId === reference.id).map((row) => row.kcId),
      example_ids: referenceExampleRows.filter((row) => row.referenceId === reference.id).map((row) => row.exampleId),
      experience_ids: referenceExperienceRows.filter((row) => row.referenceId === reference.id).map((row) => row.experienceId),
      misconception_ids: referenceMisconceptionRows.filter((row) => row.referenceId === reference.id).map((row) => row.misconceptionId),
    })),
    modules: moduleRows.map((module) => ({
      id: module.id,
      title: module.title,
      outcome_ids: by(moduleOutcomeRows, 'moduleId')(module.id).sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.outcomeId),
      kc_ids: by(moduleKcRows, 'moduleId')(module.id).sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.kcId),
      experience_ids: by(moduleExperienceRows, 'moduleId')(module.id).sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.experienceId),
      sort_order: module.sortOrder,
    })),
  };
}
