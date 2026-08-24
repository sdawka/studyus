import { and, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import {
  academicTerms,
  branches,
  courses,
  events,
  kcs,
  onboardingImports,
  users,
} from '../../db/schema';
import type { CourseSetupProposal, DemoImportInput } from '../schemas/onboarding';
import { resolveSettings } from './user';

const PLACEHOLDER_KCS = new Set(['general', 'course topic', 'course foundations']);

function meaningfulKcs(proposal: CourseSetupProposal) {
  return proposal.branches.flatMap((branch) => branch.kcs).filter((kc) => !PLACEHOLDER_KCS.has(kc.name.trim().toLowerCase()));
}

export async function hasUsableCourse(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .innerJoin(kcs, eq(kcs.courseId, courses.id))
    .where(and(eq(courses.userId, userId), eq(courses.archived, false), eq(courses.setupState, 'active')))
    .limit(20);
  if (rows.length === 0) return false;
  const names = await db
    .select({ name: kcs.name })
    .from(kcs)
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(eq(courses.userId, userId), eq(courses.archived, false), eq(courses.setupState, 'active')))
    .limit(100);
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
    profile: user
      ? {
          institution_name: user.institutionName,
          program_name: user.programName,
          current_term: user.currentTerm,
          preferences: resolveSettings(user.settings).learning_preferences,
        }
      : null,
    term: term
      ? {
          id: term.id,
          label: term.label,
          starts_on: new Date(term.startsOn).toISOString().slice(0, 10),
          ends_on: new Date(term.endsOn).toISOString().slice(0, 10),
          timezone: term.timezone,
        }
      : null,
  };
}

function dateEpoch(value: string): number {
  return Date.parse(`${value}T12:00:00.000Z`);
}

function safeSlug(code: string, userId: string, draftId: string, index: number): string {
  const base = code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'course';
  return `${base}-${userId.slice(0, 6)}-${draftId.slice(0, 6)}-${index + 1}`;
}

export async function importDemoSetup(db: Db, userId: string, input: DemoImportInput) {
  const prior = await db
    .select()
    .from(onboardingImports)
    .where(and(eq(onboardingImports.userId, userId), eq(onboardingImports.sourceDraftId, input.draft_id)))
    .limit(1);
  if (prior[0]) {
    const existingCourse = prior[0].courseId
      ? await db.select({ slug: courses.slug }).from(courses).where(eq(courses.id, prior[0].courseId)).limit(1)
      : [];
    return {
      ...(await getOnboardingState(db, userId)),
      course_id: prior[0].courseId,
      course_slug: existingCourse[0]?.slug ?? null,
      imported: false,
    };
  }

  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) throw new Error('Learner not found');

  const realCourses = input.courses.filter((proposal) => proposal.source.kind !== 'simulated');
  const hasMeaningfulProposal = realCourses.some((proposal) => meaningfulKcs(proposal).length > 0);
  const now = Date.now();
  const termId = input.context ? crypto.randomUUID() : null;
  const createdCourseIds: string[] = [];
  const createdCourseSlugs: string[] = [];
  const statements: BatchItem<'sqlite'>[] = [];

  if (input.context && termId) {
    statements.push(db.update(academicTerms).set({ isCurrent: false }).where(eq(academicTerms.userId, userId)));
    statements.push(
      db.insert(academicTerms).values({
        id: termId,
        userId,
        label: input.context.term_label,
        startsOn: dateEpoch(input.context.starts_on),
        endsOn: dateEpoch(input.context.ends_on),
        timezone: input.context.timezone,
        isCurrent: true,
        createdAt: now,
      }),
    );
  }

  const settings = resolveSettings(user.settings);
  statements.push(
    db
      .update(users)
      .set({
        institutionName: input.context?.institution_name ?? user.institutionName,
        programName: input.context?.program_name ?? user.programName,
        currentTerm: input.context?.term_label ?? user.currentTerm,
        settings: { ...settings, learning_preferences: input.preferences },
        ...(hasMeaningfulProposal ? { onboardedAt: now } : {}),
      })
      .where(eq(users.id, userId)),
  );

  realCourses.forEach((proposal, courseIndex) => {
    const proposalKcs = meaningfulKcs(proposal);
    if (proposalKcs.length === 0) return;
    const courseId = crypto.randomUUID();
    const courseSlug = safeSlug(proposal.course.code, userId, input.draft_id, courseIndex);
    createdCourseIds.push(courseId);
    createdCourseSlugs.push(courseSlug);
    statements.push(
      db.insert(courses).values({
        id: courseId,
        userId,
        code: proposal.course.code,
        slug: courseSlug,
        title: proposal.course.title,
        credits: proposal.course.credits,
        instructor: proposal.course.instructor,
        term: input.context?.term_label,
        termId,
        setupState: 'active',
        archived: false,
        createdAt: now,
      }),
    );
    proposal.branches.forEach((branch) => {
      const branchKcs = branch.kcs.filter((kc) => !PLACEHOLDER_KCS.has(kc.name.trim().toLowerCase()));
      if (branchKcs.length === 0) return;
      const branchId = crypto.randomUUID();
      statements.push(
        db.insert(branches).values({ id: branchId, courseId, name: branch.name, sortOrder: branch.sort_order, createdAt: now }),
      );
      branchKcs.forEach((kc, kcIndex) => {
        statements.push(
          db.insert(kcs).values({
            id: crypto.randomUUID(),
            branchId,
            courseId,
            name: kc.name,
            kcType: kc.kc_type,
            description: kc.description,
            sortOrder: kcIndex,
            createdAt: now,
          }),
        );
      });
    });
    statements.push(
      db.insert(events).values({
        id: crypto.randomUUID(),
        userId,
        ts: now,
        type: 'course_added',
        isInstructional: false,
        isAssessment: false,
        courseId,
        payload: { source: 'demo_import', draft_id: input.draft_id },
        source: 'manual',
        createdAt: now,
      }),
    );
  });

  statements.push(
    db.insert(onboardingImports).values({
      id: crypto.randomUUID(),
      userId,
      sourceDraftId: input.draft_id,
      courseId: createdCourseIds[0] ?? null,
      createdAt: now,
    }),
  );
  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  return {
    ...(await getOnboardingState(db, userId)),
    course_id: createdCourseIds[0] ?? null,
    course_slug: createdCourseSlugs[0] ?? null,
    imported: true,
  };
}
