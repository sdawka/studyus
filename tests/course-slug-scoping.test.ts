import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { createCourse } from '../src/lib/services/courses';
import { manualProposal } from '../src/lib/demo/catalog';
import { importDemoSetup } from '../src/lib/services/onboarding';

const db = getDb(env.DB);
let alice: string;
let bob: string;

async function makeUser() {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email: `${id}@test.local`, passwordHash: 'clerk-managed' });
  return id;
}

beforeEach(async () => {
  alice = await makeUser();
  bob = await makeUser();
});

function importInput(code: string, title: string, topic: string) {
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
    preferences: { weekly_hours: 8, guidance: 'balanced' as const, depth: 'understand' as const },
    courses: [manualProposal(code, title, [topic])],
  };
}

// Slugs were globally unique, so the suffix on your course URL counted how many
// other accounts happened to hold the same course code.
describe('course slugs are unique per learner, not globally', () => {
  it('gives two learners the same slug for the same course code', async () => {
    const hers = await createCourse(db, alice, { code: 'CS 101', title: 'Intro to CS' });
    const his = await createCourse(db, bob, { code: 'CS 101', title: 'Intro to CS' });

    expect(hers.slug).toBe('cs-101');
    expect(his.slug).toBe('cs-101');
  });

  it('still suffixes within one learner', async () => {
    const first = await createCourse(db, alice, { code: 'CS 101', title: 'Intro' });
    const second = await createCourse(db, alice, { code: 'CS 101', title: 'Intro, again' });
    const third = await createCourse(db, alice, { code: 'CS 101', title: 'Once more' });

    expect([first.slug, second.slug, third.slug]).toEqual(['cs-101', 'cs-101-2', 'cs-101-3']);
  });

  it('does not let another learner\'s courses push up your suffix', async () => {
    await createCourse(db, bob, { code: 'CS 101', title: 'His' });
    await createCourse(db, bob, { code: 'CS 101', title: 'His second' });

    expect((await createCourse(db, alice, { code: 'CS 101', title: 'Hers' })).slug).toBe('cs-101');
  });
});

describe('onboarding produces a readable course URL', () => {
  it('slugs an imported course by its code alone', async () => {
    const result = await importDemoSetup(db, alice, importInput('CHEE 314', 'Fluid Mechanics', 'Bernoulli equation'));

    // Previously "chee-314-<6 chars of user id>-<6 chars of draft id>-1", which
    // put a fragment of the user id in every course URL.
    expect(result.course_slug).toBe('chee-314');
  });

  it('keeps two learners importing the same course on the same URL', async () => {
    const hers = await importDemoSetup(db, alice, importInput('CHEE 314', 'Fluid Mechanics', 'Bernoulli equation'));
    const his = await importDemoSetup(db, bob, importInput('CHEE 314', 'Fluid Mechanics', 'Bernoulli equation'));

    expect(hers.course_slug).toBe('chee-314');
    expect(his.course_slug).toBe('chee-314');
  });

  it('suffixes a second import of the same code by the same learner', async () => {
    await importDemoSetup(db, alice, importInput('CHEE 314', 'Fluid Mechanics', 'Bernoulli equation'));
    const again = await importDemoSetup(db, alice, importInput('CHEE 314', 'Fluid Mechanics II', 'Viscosity'));

    expect(again.course_slug).toBe('chee-314-2');
  });
});

// The idempotency check reads before the batch commits, so two submits of one
// draft can both pass it. The batch is atomic, so the loser writes nothing.
describe('a concurrent duplicate submit resolves idempotently', () => {
  it('returns the winner\'s import instead of failing', async () => {
    const input = importInput('CHEE 314', 'Fluid Mechanics', 'Bernoulli equation');

    const [first, second] = await Promise.all([
      importDemoSetup(db, alice, input),
      importDemoSetup(db, alice, input),
    ]);

    // Same course either way, and exactly one of them did the work.
    expect(first.course_id).toBe(second.course_id);
    expect(first.course_slug).toBe('chee-314');
    expect([first.imported, second.imported].filter(Boolean)).toHaveLength(1);
  });

  it('creates only one course', async () => {
    const input = importInput('CHEE 314', 'Fluid Mechanics', 'Bernoulli equation');
    await Promise.all([
      importDemoSetup(db, alice, input),
      importDemoSetup(db, alice, input),
    ]);

    const { results } = await env.DB.prepare('select slug from courses where user_id = ?').bind(alice).all();
    expect(results).toHaveLength(1);
  });
});
