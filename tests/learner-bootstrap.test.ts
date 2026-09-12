import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { courses, experiences, kcs, learnerRuntimeRegistry, users } from '../src/db/schema';
import { resolveLocalUser } from '../src/lib/auth/local-user';
import { DEFAULT_COURSE_KEY, DEFAULT_COURSE_VERSION, loadDefaultCourse } from '../src/lib/content/defaultCourse';
import { getCourseDomain } from '../src/lib/services/courseDraft';
import { BOOTSTRAP_COURSE_KEY, provisionLearner } from '../src/lib/services/learnerBootstrap';
import { hasUsableCourse } from '../src/lib/services/onboarding';

const db = getDb(env.DB);

beforeEach(async () => {
  await db.delete(learnerRuntimeRegistry);
  await db.delete(users);
});

describe('learner bootstrap', () => {
  it('atomically creates a new learner with one complete usable default course', async () => {
    const result = await resolveLocalUser(db, {
      id: 'clerk-bootstrap-first',
      primaryEmailAddress: 'bootstrap-first@example.test',
      firstName: 'First',
      lastName: 'Learner',
    });

    expect(result.wasCreated).toBe(true);
    expect(result.defaultCourse).toMatchObject({
      userId: result.user.id,
      bootstrapKey: BOOTSTRAP_COURSE_KEY,
      sourceTemplateKey: DEFAULT_COURSE_KEY,
      sourceTemplateVersion: String(DEFAULT_COURSE_VERSION),
      domainVersion: 2,
    });
    expect(await hasUsableCourse(db, result.user.id)).toBe(true);
    const domain = await getCourseDomain(db, result.user.id, result.defaultCourse!.id);
    expect(domain.modules).toHaveLength(5);
    expect(domain.kcs).toHaveLength(14);
    expect(domain.experiences).toHaveLength(10);
  });

  it('returns the same learner and course on sequential and concurrent retries', async () => {
    const identity = { id: 'clerk-bootstrap-repeat', primaryEmailAddress: 'bootstrap-repeat@example.test' };
    const first = await provisionLearner(db, identity);
    const sequential = await resolveLocalUser(db, identity);
    const concurrentIdentity = { id: 'clerk-bootstrap-concurrent', primaryEmailAddress: 'bootstrap-concurrent@example.test' };
    const [concurrentA, concurrentB] = await Promise.all([
      provisionLearner(db, concurrentIdentity),
      provisionLearner(db, concurrentIdentity),
    ]);

    expect(sequential).toMatchObject({ wasCreated: false, user: { id: first.user.id }, defaultCourse: { id: first.defaultCourse.id } });
    expect(concurrentA.user.id).toBe(concurrentB.user.id);
    expect(concurrentA.defaultCourse.id).toBe(concurrentB.defaultCourse.id);
    expect([concurrentA.wasCreated, concurrentB.wasCreated].sort()).toEqual([false, true]);
    expect(await db.select().from(courses).where(eq(courses.userId, concurrentA.user.id))).toHaveLength(1);
  });

  it('rolls back the learner when a course statement fails and creates no runtime registry', async () => {
    await env.DB.exec("CREATE TRIGGER fail_bootstrap_course BEFORE INSERT ON courses BEGIN SELECT RAISE(ABORT, 'forced course failure'); END");
    try {
      await expect(provisionLearner(db, {
        id: 'clerk-bootstrap-failure',
        primaryEmailAddress: 'bootstrap-failure@example.test',
      })).rejects.toThrow('forced course failure');
    } finally {
      await env.DB.exec('DROP TRIGGER fail_bootstrap_course');
    }

    expect(await db.select().from(users).where(eq(users.clerkUserId, 'clerk-bootstrap-failure'))).toEqual([]);
    expect(await db.select().from(courses)).toEqual([]);
    expect(await db.select().from(learnerRuntimeRegistry)).toEqual([]);
  });

  it('gives different learners detached editable aggregate IDs', async () => {
    const first = await provisionLearner(db, { id: 'clerk-detached-a', primaryEmailAddress: 'detached-a@example.test' });
    const second = await provisionLearner(db, { id: 'clerk-detached-b', primaryEmailAddress: 'detached-b@example.test' });
    const [firstKc] = await db.select().from(kcs).where(eq(kcs.courseId, first.defaultCourse.id));
    const [secondKc] = await db.select().from(kcs).where(eq(kcs.courseId, second.defaultCourse.id));
    const [firstExperience] = await db.select().from(experiences).where(eq(experiences.courseId, first.defaultCourse.id));

    expect(first.defaultCourse.id).not.toBe(second.defaultCourse.id);
    expect(firstKc.id).not.toBe(secondKc.id);
    await db.update(kcs).set({ name: 'My edited learning concept' }).where(eq(kcs.id, firstKc.id));
    await db.delete(experiences).where(eq(experiences.id, firstExperience.id));

    const immutableTemplate = loadDefaultCourse();
    const firstDomain = await getCourseDomain(db, first.user.id, first.defaultCourse.id);
    const secondDomain = await getCourseDomain(db, second.user.id, second.defaultCourse.id);
    expect(firstDomain.kcs[0].name).toBe('My edited learning concept');
    expect(firstDomain.experiences).toHaveLength(9);
    expect(immutableTemplate.kcs[0].name).not.toBe('My edited learning concept');
    expect(immutableTemplate.experiences).toHaveLength(10);
    expect(secondDomain.kcs[0].name).toBe(immutableTemplate.kcs[0].name);
    expect(secondDomain.experiences).toHaveLength(10);
  });

  it('pins each enrollment to the template version used when it was created', async () => {
    const firstDraft = loadDefaultCourse();
    const first = await provisionLearner(
      db,
      { id: 'clerk-version-a', primaryEmailAddress: 'version-a@example.test' },
      { draft: firstDraft, key: DEFAULT_COURSE_KEY, version: 'test-v1' },
    );
    const nextDraft = loadDefaultCourse();
    nextDraft.spec.title = 'Learning How to Learn, Revised';
    const second = await provisionLearner(
      db,
      { id: 'clerk-version-b', primaryEmailAddress: 'version-b@example.test' },
      { draft: nextDraft, key: DEFAULT_COURSE_KEY, version: 'test-v2' },
    );

    const [storedFirst] = await db.select().from(courses).where(and(eq(courses.id, first.defaultCourse.id), eq(courses.userId, first.user.id)));
    const [storedSecond] = await db.select().from(courses).where(and(eq(courses.id, second.defaultCourse.id), eq(courses.userId, second.user.id)));
    expect(storedFirst).toMatchObject({ title: 'Learning How to Learn', sourceTemplateVersion: 'test-v1' });
    expect(storedSecond).toMatchObject({ title: 'Learning How to Learn, Revised', sourceTemplateVersion: 'test-v2' });
  });

  it('does not backfill a default course for an existing learner', async () => {
    await db.insert(users).values({
      id: 'legacy-no-backfill',
      clerkUserId: 'clerk-no-backfill',
      email: 'no-backfill@example.test',
      passwordHash: 'clerk-managed',
    });

    const result = await resolveLocalUser(db, { id: 'clerk-no-backfill', primaryEmailAddress: 'no-backfill@example.test' });

    expect(result).toMatchObject({ wasCreated: false, defaultCourse: null });
    expect(await db.select().from(courses).where(eq(courses.userId, result.user.id))).toEqual([]);
  });
});
