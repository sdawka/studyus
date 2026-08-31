import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { courses, kcs, onboardingImports, users } from '../src/db/schema';
import { manualProposal } from '../src/lib/demo/catalog';
import { hasUsableCourse, importDemoSetup } from '../src/lib/services/onboarding';

const db = getDb(env.DB);
let userId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'clerk-managed' });
});

function input(course: ReturnType<typeof manualProposal>, draftId = crypto.randomUUID()) {
  return {
    schema_version: 1 as const,
    draft_id: draftId,
    context: {
      institution_name: 'McGill University',
      program_name: 'Chemical Engineering',
      term_label: 'Fall 2026',
      starts_on: '2026-08-31',
      ends_on: '2026-12-22',
      timezone: 'America/Toronto',
    },
    preferences: { weekly_hours: 8, guidance: 'balanced' as const, depth: 'understand' as const },
    courses: [course],
  };
}

// The onboarding client's reviewReady() accepts any included KC whose name is
// at least two characters, but hasUsableCourse() rejects the placeholder names
// ('general', 'course topic', 'course foundations'). So a draft can pass the
// client's gate and still not satisfy the server's definition of usable. These
// tests cover what happens in that gap — the retry path a user actually walks
// after seeing "one real course with at least one concept is still required".
const placeholderCourse = () => manualProposal('CHEE 200', 'Intro', ['General']);
const realCourse = () => manualProposal('CHEE 314', 'Fluid Mechanics', ['Bernoulli equation']);

describe('onboarding import: a draft the client accepts but the server finds unusable', () => {
  it('creates nothing at all rather than a half-built course', async () => {
    const result = await importDemoSetup(db, userId, input(placeholderCourse()));

    expect(result.complete).toBe(false);
    expect(result.has_usable_course).toBe(false);
    expect(result.imported).toBe(false);
    expect(result.course_slug).toBeNull();
    expect(await db.select().from(courses).where(eq(courses.userId, userId))).toHaveLength(0);
    expect(await db.select().from(kcs)).toHaveLength(0);
  });

  it('does not mark the learner onboarded', async () => {
    await importDemoSetup(db, userId, input(placeholderCourse()));
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user.onboardedAt).toBeNull();
  });

  it('still saves the profile and preferences, so the form is not lost', async () => {
    await importDemoSetup(db, userId, input(placeholderCourse()));
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user.institutionName).toBe('McGill University');
    expect(user.currentTerm).toBe('Fall 2026');
  });

  it('writes no idempotency row, which is what keeps the draft retryable', async () => {
    const payload = input(placeholderCourse());
    await importDemoSetup(db, userId, payload);
    expect(await db.select().from(onboardingImports).where(eq(onboardingImports.userId, userId))).toHaveLength(0);
  });

  it('lets the user fix the topics and retry under the SAME browser draft id', async () => {
    // This is the path that matters. clearDemoDraft() only runs after a
    // successful import, so a user who corrects their topics retries with the
    // draft_id they already had. If the incomplete attempt had written an
    // idempotency row, that retry would early-return and strand them.
    const draftId = crypto.randomUUID();
    const first = await importDemoSetup(db, userId, input(placeholderCourse(), draftId));
    expect(first.complete).toBe(false);

    const retry = await importDemoSetup(db, userId, input(realCourse(), draftId));

    expect(retry.imported).toBe(true);
    expect(retry.complete).toBe(true);
    expect(retry.course_slug).toContain('chee-314');
    expect(await hasUsableCourse(db, userId)).toBe(true);
    expect(await db.select().from(courses).where(eq(courses.userId, userId))).toHaveLength(1);
  });

  it('is idempotent again once an import has actually succeeded', async () => {
    const draftId = crypto.randomUUID();
    await importDemoSetup(db, userId, input(realCourse(), draftId));
    const second = await importDemoSetup(db, userId, input(realCourse(), draftId));

    expect(second.imported).toBe(false);
    expect(second.complete).toBe(true);
    expect(await db.select().from(courses).where(eq(courses.userId, userId))).toHaveLength(1);
  });
});
