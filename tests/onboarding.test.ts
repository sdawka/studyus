import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { academicTerms, courses, events, kcs, onboardingImports, users } from '../src/db/schema';
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
    expect((await db.select().from(events).where(eq(events.userId, userId)))[0].type).toBe('course_added');
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
  });
});
