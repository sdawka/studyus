import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import {
  academicTerms,
  assessments,
  courses,
  events,
  exercises,
  kcEdges,
  kcs,
  misconceptions,
  onboardingImports,
  resources,
  scaffolds,
  users,
} from '../src/db/schema';
import { proposalFromReviewedTemplate } from '../src/lib/content/templateCatalog';
import { manualProposal } from '../src/lib/demo/catalog';
import { getOnboardingState, hasUsableCourse, importDemoSetup } from '../src/lib/services/onboarding';

const db = getDb(env.DB);
let userId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'clerk-managed' });
});

function input(course = manualProposal('CHEE 314', 'Fluid Mechanics', ['Bernoulli equation', 'Control-volume balance'])) {
  return {
    schema_version: 1 as const,
    draft_id: crypto.randomUUID(),
    context: {
      institution_name: 'McGill University',
      program_name: 'Chemical Engineering',
      term_label: 'Fall 2026',
      starts_on: '2026-08-31',
      ends_on: '2026-12-22',
      timezone: 'America/Toronto',
    },
    preferences: { weekly_hours: 8, guidance: 'tell_me_next' as const, depth: 'master' as const },
    courses: [course],
  };
}

describe('onboarding import', () => {
  it('atomically creates learner context, a real course, KCs, and completion state', async () => {
    const result = await importDemoSetup(db, userId, input());

    expect(result).toMatchObject({ complete: true, has_usable_course: true, imported: true });
    expect(result.course_slug).toContain('chee-314');
    expect(await hasUsableCourse(db, userId)).toBe(true);

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user).toMatchObject({ institutionName: 'McGill University', programName: 'Chemical Engineering', currentTerm: 'Fall 2026' });
    expect(user.onboardedAt).not.toBeNull();
    expect(user.settings).toMatchObject({ learning_preferences: { weekly_hours: 8, guidance: 'tell_me_next', depth: 'master' } });

    expect(await db.select().from(academicTerms).where(eq(academicTerms.userId, userId))).toHaveLength(1);
    expect(await db.select().from(courses).where(eq(courses.userId, userId))).toHaveLength(1);
    expect(await db.select().from(kcs)).toHaveLength(2);
    expect((await db.select().from(events).where(eq(events.userId, userId)))[0]).toMatchObject({ type: 'course_added', source: 'system' });
  });

  it('is idempotent for repeated auth redirects or submissions', async () => {
    const payload = input();
    const first = await importDemoSetup(db, userId, payload);
    const second = await importDemoSetup(db, userId, payload);

    expect(first.imported).toBe(true);
    expect(second.imported).toBe(false);
    expect(second.course_id).toBe(first.course_id);
    expect(await db.select().from(courses).where(eq(courses.userId, userId))).toHaveLength(1);
    expect(await db.select().from(onboardingImports).where(eq(onboardingImports.userId, userId))).toHaveLength(1);
  });

  it('does not complete onboarding with simulated or placeholder-only content', async () => {
    const placeholder = manualProposal('DEMO 101', 'Sample', ['General']);
    placeholder.source.kind = 'simulated';
    const payload = input(placeholder);
    const result = await importDemoSetup(db, userId, payload);

    expect(result.complete).toBe(false);
    expect(result.course_id).toBeNull();
    expect((await getOnboardingState(db, userId)).has_usable_course).toBe(false);
    expect(await db.select().from(onboardingImports).where(eq(onboardingImports.userId, userId))).toHaveLength(0);

    payload.courses = [manualProposal('CHEE 314', 'Fluid Mechanics', ['Bernoulli equation'])];
    const retry = await importDemoSetup(db, userId, payload);
    expect(retry).toMatchObject({ complete: true, imported: true });
  });

  it('atomically clones reviewed content while preserving learner edits and explicit unknown dates', async () => {
    const proposal = proposalFromReviewedTemplate('chee-310-physical-chemistry-for-engineers')!;
    proposal.branches[0].name = 'My kinetics sequence';
    proposal.branches[0].sort_order = 9;
    proposal.branches[0].kcs[0].name = 'Rate laws — renamed';
    proposal.assessments.forEach((assessment) => {
      if (assessment.kind === 'official') assessment.date_status = 'unknown';
    });

    const result = await importDemoSetup(db, userId, input(proposal));
    const [course] = await db.select().from(courses).where(eq(courses.id, result.course_id!));
    expect(course.templateId).toBe('chee-310-physical-chemistry-for-engineers');
    expect((await db.select().from(kcs).where(eq(kcs.courseId, course.id))).some((kc) => kc.name === 'Rate laws — renamed')).toBe(true);
    expect(await db.select().from(scaffolds)).not.toHaveLength(0);
    expect(await db.select().from(misconceptions)).not.toHaveLength(0);
    expect(await db.select().from(exercises)).not.toHaveLength(0);
    expect(await db.select().from(resources).where(eq(resources.courseId, course.id))).not.toHaveLength(0);
    expect(await db.select().from(kcEdges)).not.toHaveLength(0);
    const storedAssessments = await db.select().from(assessments).where(eq(assessments.courseId, course.id));
    expect(storedAssessments).not.toHaveLength(0);
    expect(storedAssessments.filter((assessment) => assessment.kind === 'official').every((assessment) => assessment.dueDate === null)).toBe(true);
  });

  it('rejects unresolved dates, out-of-term dates, and excluded prerequisites before writing', async () => {
    const unresolved = proposalFromReviewedTemplate('chee-310-physical-chemistry-for-engineers')!;
    await expect(importDemoSetup(db, userId, input(unresolved))).rejects.toThrow('Confirm a date');

    unresolved.assessments.forEach((assessment) => {
      if (assessment.kind === 'official') assessment.date_status = 'unknown';
    });
    const dated = unresolved.assessments.find((assessment) => assessment.kind === 'official')!;
    dated.date_status = 'confirmed';
    dated.due_on = '2027-01-02';
    await expect(importDemoSetup(db, userId, input(unresolved))).rejects.toThrow('selected semester');

    dated.date_status = 'unknown';
    delete dated.due_on;
    const prerequisite = unresolved.branches.flatMap((branch) => branch.kcs).find((kc) => kc.template_ref === 'rate-laws-and-reaction-order')!;
    prerequisite.included = false;
    await expect(importDemoSetup(db, userId, input(unresolved))).rejects.toThrow('requires');
    expect(await db.select().from(courses).where(eq(courses.userId, userId))).toHaveLength(0);
  });
});
