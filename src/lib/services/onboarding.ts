import { and, eq, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import {
  academicTerms,
  assessmentKcs,
  assessments,
  branches,
  courses,
  courseTemplateDecisions,
  events,
  exercises,
  kcEdges,
  kcs,
  misconceptions,
  onboardingImports,
  resources,
  scaffolds,
  users,
} from '../../db/schema';
import { parseKcRef, type ContentAssessment } from '../content/courseContent';
import { getAssessmentTemplateRef, getReviewedTemplate, getReviewedTemplateRevision, getTemplateBaseline } from '../content/templateCatalog';
import { exerciseDetails } from '../content/exercises';
import type { CourseSetupProposal, DemoImportInput } from '../schemas/onboarding';
import { ConflictError } from './util';
import { resolveSettings } from './user';

const PLACEHOLDER_KCS = new Set(['general', 'course topic', 'course foundations']);

function meaningfulKcs(proposal: CourseSetupProposal) {
  return proposal.branches
    .filter((branch) => branch.included)
    .flatMap((branch) => branch.kcs.filter((kc) => kc.included))
    .filter((kc) => !PLACEHOLDER_KCS.has(kc.name.trim().toLowerCase()));
}

export async function hasUsableCourse(db: Db, userId: string): Promise<boolean> {
  const rows = await db.select({ id: courses.id }).from(courses).innerJoin(kcs, eq(kcs.courseId, courses.id)).innerJoin(branches, eq(kcs.branchId, branches.id))
    .where(and(eq(courses.userId, userId), eq(courses.archived, false), eq(courses.setupState, 'active'), isNull(branches.archivedAt), isNull(kcs.archivedAt))).limit(20);
  if (rows.length === 0) return false;
  const names = await db.select({ name: kcs.name }).from(kcs).innerJoin(branches, eq(kcs.branchId, branches.id)).innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(eq(courses.userId, userId), eq(courses.archived, false), eq(courses.setupState, 'active'), isNull(branches.archivedAt), isNull(kcs.archivedAt))).limit(100);
  return names.some((row) => !PLACEHOLDER_KCS.has(row.name.trim().toLowerCase()));
}

export async function getOnboardingState(db: Db, userId: string) {
  const [userRows, termRows, usableCourse] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db.select().from(academicTerms).where(and(eq(academicTerms.userId, userId), eq(academicTerms.isCurrent, true))).limit(1),
    hasUsableCourse(db, userId),
  ]);
  const user = userRows[0];
  const term = termRows[0] ?? null;
  return {
    complete: Boolean(user?.onboardedAt && usableCourse),
    has_usable_course: usableCourse,
    profile: user ? {
      institution_name: user.institutionName,
      program_name: user.programName,
      current_term: user.currentTerm,
      preferences: resolveSettings(user.settings).learning_preferences,
    } : null,
    term: term ? {
      id: term.id,
      label: term.label,
      starts_on: new Date(term.startsOn).toISOString().slice(0, 10),
      ends_on: new Date(term.endsOn).toISOString().slice(0, 10),
      timezone: term.timezone,
    } : null,
  };
}

function dateEpoch(value: string): number {
  return Date.parse(`${value}T12:00:00.000Z`);
}

function safeSlug(code: string, userId: string, draftId: string, index: number): string {
  const base = code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'course';
  return `${base}-${userId.slice(0, 6)}-${draftId.slice(0, 6)}-${index + 1}`;
}

type SetupBranch = CourseSetupProposal['branches'][number];
type SetupKc = SetupBranch['kcs'][number];
type ReviewedSelection = {
  template: NonNullable<ReturnType<typeof getReviewedTemplate>>;
  branchOverrides: Map<string, SetupBranch>;
  kcOverrides: Map<string, SetupKc>;
  selectedKcRefs: Set<string>;
  assessmentDates: Map<string, number | null>;
};

function reviewSelection(proposal: CourseSetupProposal, input: DemoImportInput): ReviewedSelection | null {
  if (!proposal.template_id) return null;
  const template = getReviewedTemplate(proposal.template_id);
  if (!template) throw new ConflictError('This reviewed course template is no longer available. Choose it again.');

  const branchOverrides = new Map<string, SetupBranch>();
  const kcOverrides = new Map<string, SetupKc>();
  for (const branch of proposal.branches) {
    if (!branch.template_ref || branchOverrides.has(branch.template_ref)) throw new ConflictError('Review this course again before importing it.');
    branchOverrides.set(branch.template_ref, branch);
    for (const kc of branch.kcs) {
      if (!kc.template_ref || kcOverrides.has(kc.template_ref)) throw new ConflictError('Review this course again before importing it.');
      kcOverrides.set(kc.template_ref, kc);
    }
  }

  const authoredBranches = new Set(template.content.branches.map((branch) => branch.slug));
  const authoredKcs = new Set(template.content.branches.flatMap((branch) => branch.kcs.map((kc) => kc.slug)));
  if ([...branchOverrides.keys()].some((ref) => !authoredBranches.has(ref)) || [...kcOverrides.keys()].some((ref) => !authoredKcs.has(ref))) {
    throw new ConflictError('The reviewed course map changed. Reload it before importing.');
  }

  const selectedKcRefs = new Set<string>();
  for (const branch of template.content.branches) {
    const branchOverride = branchOverrides.get(branch.slug);
    if (!branchOverride?.included) continue;
    for (const kc of branch.kcs) if (kcOverrides.get(kc.slug)?.included) selectedKcRefs.add(kc.slug);
  }
  if (selectedKcRefs.size === 0) throw new ConflictError('Include at least one knowledge component.');

  for (const branch of template.content.branches) {
    for (const kc of branch.kcs) {
      if (!selectedKcRefs.has(kc.slug)) continue;
      for (const ref of kc.prereqs) {
        const prereq = parseKcRef(ref, proposal.template_id);
        if (prereq.courseSlug === proposal.template_id && authoredKcs.has(prereq.kcSlug) && !selectedKcRefs.has(prereq.kcSlug)) {
          throw new ConflictError(`“${kc.name}” requires “${prereq.kcSlug.replaceAll('-', ' ')}”. Include its prerequisite first.`);
        }
      }
    }
  }

  const suppliedAssessments = new Map(proposal.assessments.map((assessment) => [assessment.template_ref, assessment]));
  const assessmentDates = new Map<string, number | null>();
  template.content.assessments.forEach((assessment, index) => {
    const ref = getAssessmentTemplateRef(index, assessment.title);
    const supplied = suppliedAssessments.get(ref);
    if (!supplied || supplied.title !== assessment.title || supplied.type !== assessment.type || supplied.kind !== assessment.kind) {
      throw new ConflictError('Assessment details changed. Review the course dates again.');
    }
    if (assessment.kind === 'official' && supplied.date_status === 'unset') {
      throw new ConflictError(`Confirm a date or choose “I don’t know” for ${assessment.title}.`);
    }
    if (assessment.kind === 'official' && supplied.date_status === 'confirmed' && supplied.due_on) {
      if (input.context && (supplied.due_on < input.context.starts_on || supplied.due_on > input.context.ends_on)) {
        throw new ConflictError(`${assessment.title} must fall within the selected semester.`);
      }
      assessmentDates.set(ref, dateEpoch(supplied.due_on));
    } else assessmentDates.set(ref, null);
  });

  return { template, branchOverrides, kcOverrides, selectedKcRefs, assessmentDates };
}

function selectedAssessmentKc(assessment: ContentAssessment, courseSlug: string, selectedKcRefs: Set<string>): string[] {
  return assessment.kc_slugs.map((ref) => parseKcRef(ref, courseSlug))
    .filter((ref) => ref.courseSlug !== courseSlug || selectedKcRefs.has(ref.kcSlug)).map((ref) => ref.key);
}

export async function importDemoSetup(db: Db, userId: string, input: DemoImportInput) {
  const prior = await db.select().from(onboardingImports)
    .where(and(eq(onboardingImports.userId, userId), eq(onboardingImports.sourceDraftId, input.draft_id))).limit(1);
  if (prior[0]) {
    const existingCourse = prior[0].courseId
      ? await db.select({ slug: courses.slug }).from(courses).where(eq(courses.id, prior[0].courseId)).limit(1) : [];
    return {
      ...(await getOnboardingState(db, userId)),
      course_id: prior[0].courseId,
      course_slug: existingCourse[0]?.slug ?? null,
      imported: false,
      behavioral: null,
    };
  }

  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) throw new Error('Learner not found');

  const realCourses = input.courses.filter((proposal) => proposal.source.kind !== 'simulated');
  const hasMeaningfulProposal = realCourses.some((proposal) => meaningfulKcs(proposal).length > 0);
  const reviewedSelections = new Map<CourseSetupProposal, ReviewedSelection>();
  const reviewedRevisions = new Map<CourseSetupProposal, string>();
  for (const proposal of realCourses) {
    const reviewed = reviewSelection(proposal, input);
    if (reviewed) {
      reviewedSelections.set(proposal, reviewed);
      const revision = await getReviewedTemplateRevision(proposal.template_id!);
      if (revision) reviewedRevisions.set(proposal, revision);
    }
  }

  const now = Date.now();
  const termId = input.context ? crypto.randomUUID() : null;
  const createdCourseIds: string[] = [];
  const createdCourseSlugs: string[] = [];
  const committedProposals: CourseSetupProposal[] = [];
  const statements: BatchItem<'sqlite'>[] = [];
  const kcIdByTemplateKey = new Map<string, string>();

  const existingTemplateKcs = await db.select({ id: kcs.id, slug: kcs.slug, templateId: courses.templateId })
    .from(kcs).innerJoin(branches, eq(kcs.branchId, branches.id)).innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(eq(courses.userId, userId), isNull(kcs.archivedAt), isNull(branches.archivedAt)));
  for (const row of existingTemplateKcs) if (row.templateId && row.slug) kcIdByTemplateKey.set(`${row.templateId}#${row.slug}`, row.id);

  if (input.context && termId) {
    statements.push(db.update(academicTerms).set({ isCurrent: false }).where(eq(academicTerms.userId, userId)));
    statements.push(db.insert(academicTerms).values({
      id: termId, userId, label: input.context.term_label, startsOn: dateEpoch(input.context.starts_on),
      endsOn: dateEpoch(input.context.ends_on), timezone: input.context.timezone, isCurrent: true, createdAt: now,
    }));
  }

  const settings = resolveSettings(user.settings);
  statements.push(db.update(users).set({
    institutionName: input.context?.institution_name ?? user.institutionName,
    programName: input.context?.program_name ?? user.programName,
    currentTerm: input.context?.term_label ?? user.currentTerm,
    settings: { ...settings, learning_preferences: input.preferences },
    ...(hasMeaningfulProposal ? { onboardedAt: now } : {}),
  }).where(eq(users.id, userId)));

  const assessmentIdByTemplateRef = new Map<string, string>();

  realCourses.forEach((proposal, courseIndex) => {
    if (meaningfulKcs(proposal).length === 0) return;
    const reviewed = reviewedSelections.get(proposal);
    const courseId = crypto.randomUUID();
    const courseCode = reviewed?.template.meta.code ?? proposal.course.code;
    const courseSlug = safeSlug(courseCode, userId, input.draft_id, courseIndex);
    createdCourseIds.push(courseId);
    createdCourseSlugs.push(courseSlug);
    committedProposals.push(proposal);
    statements.push(db.insert(courses).values({
      id: courseId, userId, code: courseCode, templateId: proposal.template_id, slug: courseSlug,
      templateRevision: reviewedRevisions.get(proposal),
      templateBaseline: proposal.template_id ? getTemplateBaseline(proposal.template_id) : null,
      templateSyncedAt: reviewed ? now : null,
      title: reviewed?.template.meta.title ?? proposal.course.title,
      credits: reviewed?.template.meta.credits ?? proposal.course.credits,
      instructor: reviewed ? undefined : proposal.course.instructor,
      term: input.context?.term_label, termId, overview: reviewed?.template.meta.overview,
      sourceUrl: reviewed?.template.meta.source, setupState: 'active', archived: false, createdAt: now,
    }));

    if (!reviewed) {
      proposal.branches.filter((branch) => branch.included).forEach((branch) => {
        const branchKcs = branch.kcs.filter((kc) => kc.included && !PLACEHOLDER_KCS.has(kc.name.trim().toLowerCase()));
        if (branchKcs.length === 0) return;
        const branchId = crypto.randomUUID();
        statements.push(db.insert(branches).values({ id: branchId, courseId, name: branch.name, sortOrder: branch.sort_order, createdAt: now }));
        branchKcs.forEach((kc, kcIndex) => statements.push(db.insert(kcs).values({
          id: crypto.randomUUID(), branchId, courseId, name: kc.name, kcType: kc.kc_type,
          description: kc.description, sortOrder: kc.sort_order ?? kcIndex, createdAt: now,
        })));
      });
    } else {
      for (const authoredBranch of reviewed.template.content.branches) {
        const branchOverride = reviewed.branchOverrides.get(authoredBranch.slug);
        if (!branchOverride?.included) {
          statements.push(db.insert(courseTemplateDecisions).values({ id: crypto.randomUUID(), courseId, itemKind: 'branch', templateRef: authoredBranch.slug, decision: 'dismissed', templateRevision: reviewedRevisions.get(proposal)!, createdAt: now, updatedAt: now }));
          continue;
        }
        const selected = authoredBranch.kcs.filter((kc) => reviewed.selectedKcRefs.has(kc.slug));
        const omitted = authoredBranch.kcs.filter((kc) => !reviewed.selectedKcRefs.has(kc.slug));
        for (const kc of omitted) {
          statements.push(db.insert(courseTemplateDecisions).values({ id: crypto.randomUUID(), courseId, itemKind: 'kc', templateRef: kc.slug, decision: 'dismissed', templateRevision: reviewedRevisions.get(proposal)!, createdAt: now, updatedAt: now }));
        }
        if (selected.length === 0) continue;
        const branchId = crypto.randomUUID();
        statements.push(db.insert(branches).values({
          id: branchId, courseId, name: branchOverride.name, templateRef: authoredBranch.slug,
          sortOrder: branchOverride.sort_order, createdAt: now,
        }));
        for (const authoredKc of selected) {
          const override = reviewed.kcOverrides.get(authoredKc.slug)!;
          const kcId = crypto.randomUUID();
          kcIdByTemplateKey.set(`${proposal.template_id}#${authoredKc.slug}`, kcId);
          statements.push(db.insert(kcs).values({
            id: kcId, branchId, courseId, name: override.name, kcType: authoredKc.kc_type,
            description: authoredKc.description, practiceNotes: authoredKc.practice_notes, slug: authoredKc.slug,
            sortOrder: override.sort_order, createdAt: now,
          }));
          authoredKc.scaffolds.forEach((scaffold, index) => statements.push(db.insert(scaffolds).values({
            id: crypto.randomUUID(), kcId, kind: scaffold.kind, level: scaffold.level, title: scaffold.title,
            body: scaffold.body, details: scaffold.details, sortOrder: index, source: 'seed', createdAt: now,
          })));
          authoredKc.misconceptions.forEach((misconception) => statements.push(db.insert(misconceptions).values({
            id: crypto.randomUUID(), kcId, slug: misconception.slug, name: misconception.name,
            description: misconception.description, rootCause: misconception.root_cause,
            diagnosticProbe: misconception.diagnostic_probe, correction: misconception.correction, source: 'seed', createdAt: now,
          })));
          authoredKc.resources.forEach((resource) => statements.push(db.insert(resources).values({
            id: crypto.randomUUID(), userId, courseId, kcId, url: resource.url, label: resource.label,
            kind: resource.kind, pinned: resource.pinned, addedBy: 'reviewed_template', createdAt: now,
          })));
        }
      }
      reviewed.template.content.course_resources.forEach((resource) => statements.push(db.insert(resources).values({
        id: crypto.randomUUID(), userId, courseId, url: resource.url, label: resource.label,
        kind: resource.kind, pinned: resource.pinned, addedBy: 'reviewed_template', createdAt: now,
      })));
      reviewed.template.exercises.exercises.filter((exercise) => reviewed.selectedKcRefs.has(exercise.kc)).forEach((exercise, index) => {
        const kcId = kcIdByTemplateKey.get(`${proposal.template_id}#${exercise.kc}`)!;
        statements.push(db.insert(exercises).values({
          id: crypto.randomUUID(), kcId, slug: exercise.slug, kind: exercise.kind, difficulty: exercise.difficulty,
          prompt: exercise.prompt, details: exerciseDetails(exercise), source: exercise.source,
          origin: 'seed', sortOrder: index, createdAt: now,
        }));
      });
      reviewed.template.content.assessments.forEach((assessment, index) => {
        const ref = getAssessmentTemplateRef(index, assessment.title);
        const assessmentId = crypto.randomUUID();
        assessmentIdByTemplateRef.set(`${proposal.template_id}#${ref}`, assessmentId);
        statements.push(db.insert(assessments).values({
          id: assessmentId, courseId, title: assessment.title, type: assessment.type, kind: assessment.kind,
          weightPct: assessment.weight_pct, dueDate: reviewed.assessmentDates.get(ref) ?? null, createdAt: now,
        }));
      });
    }

    // Inline insert (not createEvent): the event must join the atomic clone
    // batch that creates the course row it references. No kc_id, so no fold.
    statements.push(db.insert(events).values({
      id: crypto.randomUUID(), userId, ts: now, type: 'course_added', isInstructional: false,
      isAssessment: false, courseId, payload: { source: 'demo_import', draft_id: input.draft_id }, source: 'system', createdAt: now,
    }));
  });

  // Reconcile reviewed prerequisite edges across every learner-owned template.
  // This also backfills a cross-course edge when its prerequisite course is
  // imported after the course that depends on it.
  const ownedTemplateIds = new Set([...kcIdByTemplateKey.keys()].map((key) => key.slice(0, key.indexOf('#'))));
  for (const templateId of ownedTemplateIds) {
    const ownedTemplate = getReviewedTemplate(templateId);
    if (!ownedTemplate) continue;
    for (const branch of ownedTemplate.content.branches) {
      for (const kc of branch.kcs) {
        const kcId = kcIdByTemplateKey.get(`${templateId}#${kc.slug}`);
        if (!kcId) continue;
        for (const ref of kc.prereqs) {
          const prereqKcId = kcIdByTemplateKey.get(parseKcRef(ref, templateId).key);
          if (prereqKcId) statements.push(db.insert(kcEdges).values({
            id: crypto.randomUUID(), kcId, prereqKcId, source: 'seed', createdAt: now,
          }).onConflictDoNothing());
        }
      }
    }
  }

  for (const [proposal, reviewed] of reviewedSelections) {
    reviewed.template.content.assessments.forEach((assessment, index) => {
      const ref = getAssessmentTemplateRef(index, assessment.title);
      const assessmentId = assessmentIdByTemplateRef.get(`${proposal.template_id}#${ref}`);
      if (!assessmentId) return;
      for (const kcKey of selectedAssessmentKc(assessment, proposal.template_id!, reviewed.selectedKcRefs)) {
        const kcId = kcIdByTemplateKey.get(kcKey);
        if (kcId) statements.push(db.insert(assessmentKcs).values({ id: crypto.randomUUID(), assessmentId, kcId, createdAt: now }));
      }
    });
  }

  // Empty or simulated drafts remain retryable with the same browser draft id.
  if (createdCourseIds.length > 0) statements.push(db.insert(onboardingImports).values({
    id: crypto.randomUUID(), userId, sourceDraftId: input.draft_id, courseId: createdCourseIds[0], createdAt: now,
  }));
  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  return {
    ...(await getOnboardingState(db, userId)),
    course_id: createdCourseIds[0] ?? null,
    course_slug: createdCourseSlugs[0] ?? null,
    imported: createdCourseIds.length > 0,
    behavioral: createdCourseIds.length > 0 ? {
      completed_at: now,
      path: committedProposals[0]?.source.kind === 'upload'
        ? 'document' as const
        : committedProposals[0]?.source.kind === 'template'
          ? 'template' as const
          : 'manual' as const,
      template_id: committedProposals.length === 1 ? committedProposals[0]?.template_id : undefined,
      course_count: createdCourseIds.length,
      kc_count: committedProposals.reduce((total, proposal) => total + meaningfulKcs(proposal).length, 0),
    } : null,
  };
}
