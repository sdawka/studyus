import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { createCourse, updateCourse } from '../src/lib/services/courses';
import { manualProposal } from '../src/lib/demo/catalog';
import { hasUsableCourse, importDemoSetup } from '../src/lib/services/onboarding';

const db = getDb(env.DB);
let userId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'clerk-managed' });
});

// Creates a course the way onboarding actually does, so the fixture matches the
// state a real learner reaches rather than a hand-built one.
async function onboardWith(code: string, title: string, topic: string) {
  const result = await importDemoSetup(db, userId, {
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
    preferences: { weekly_hours: 8, guidance: 'balanced' as const, depth: 'understand' as const },
    courses: [manualProposal(code, title, [topic])],
  });
  return result.course_id!;
}

// src/middleware.ts:118-120 redirects an authenticated user to /onboarding
// whenever hasUsableCourse() is false, and that check applies to users who
// already finished onboarding, not only new ones. isOnboardingAllowed()
// (middleware.ts:44-52) permits only /onboarding, /account, /settings,
// /sign-in and /sign-up — so /courses and /dashboard both redirect. That makes
// hasUsableCourse() the predicate for "can this learner reach the app at all",
// and anything able to flip it to false is an access-control change.
describe('losing your last usable course locks you out of the app', () => {
  it('an onboarded learner with one real course can reach the app', async () => {
    await onboardWith('CHEE 314', 'Fluid Mechanics', 'Bernoulli equation');
    expect(await hasUsableCourse(db, userId)).toBe(true);
  });

  it('refuses to archive the only course, which would revoke app access', async () => {
    const courseId = await onboardWith('CHEE 314', 'Fluid Mechanics', 'Bernoulli equation');
    expect(await hasUsableCourse(db, userId)).toBe(true);

    // FIXED: updateCourse now refuses this, matching updateCourseMap's existing
    // 'Keep at least one meaningful active concept.' guard one level down.
    // Previously it succeeded and stranded the learner on /onboarding, with
    // /courses — the only place to unarchive — also redirecting there.
    await expect(updateCourse(db, userId, courseId, { archived: true })).rejects.toThrow(/lock you out/i);
    expect(await hasUsableCourse(db, userId)).toBe(true);
  });

  it('archiving one of two courses is fine and must keep working', async () => {
    const first = await onboardWith('CHEE 314', 'Fluid Mechanics', 'Bernoulli equation');
    await onboardWith('MATH 262', 'Calculus', 'Taylor series');

    await updateCourse(db, userId, first.valueOf(), { archived: true });
    expect(await hasUsableCourse(db, userId)).toBe(true);
  });

  it('still allows archiving when the learner had no usable course to begin with', async () => {
    // createCourse seeds a placeholder map, so a bare course is not "usable".
    // Archiving it removes no access, and the guard must not block it.
    const bare = await createCourse(db, userId, { code: 'CHEE 200', title: 'Intro' });
    expect(await hasUsableCourse(db, userId)).toBe(false);

    await updateCourse(db, userId, bare.id, { archived: true });
    expect(await hasUsableCourse(db, userId)).toBe(false);
  });
});
