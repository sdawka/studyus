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

describe('an onboarded learner may empty and rebuild their workspace', () => {
  it('an onboarded learner with one real course can reach the app', async () => {
    await onboardWith('CHEE 314', 'Fluid Mechanics', 'Bernoulli equation');
    expect(await hasUsableCourse(db, userId)).toBe(true);
  });

  it('allows archiving the only course without reopening onboarding', async () => {
    const courseId = await onboardWith('CHEE 314', 'Fluid Mechanics', 'Bernoulli equation');
    expect(await hasUsableCourse(db, userId)).toBe(true);

    await updateCourse(db, userId, courseId, { archived: true });
    expect(await hasUsableCourse(db, userId)).toBe(false);
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
