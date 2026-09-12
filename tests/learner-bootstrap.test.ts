import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { accountDeletionEvents, accountDeletionJobs, courses, events, experiences, kcs, learnerRuntimeRegistry, users } from '../src/db/schema';
import { resolveLocalUser } from '../src/lib/auth/local-user';
import { DEFAULT_COURSE_KEY, DEFAULT_COURSE_VERSION, loadDefaultCourse } from '../src/lib/content/defaultCourse';
import { getCourseAuthoringDomain, getCourseDomain } from '../src/lib/services/courseDraft';
import { BOOTSTRAP_COURSE_KEY, provisionLearner } from '../src/lib/services/learnerBootstrap';
import { AccountInactiveError, enqueueAccountDeletion } from '../src/lib/services/accountLifecycle';
import { hasUsableCourse } from '../src/lib/services/onboarding';
import { getKcState, getNextExperience } from '../src/lib/services/mastery';
import { createEvent, respondToExperience } from '../src/lib/services/events';

const db = getDb(env.DB);

beforeEach(async () => {
  await db.delete(accountDeletionJobs);
  await db.delete(accountDeletionEvents);
  await db.delete(learnerRuntimeRegistry);
  await db.delete(users);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

function holdNextBatch() {
  const started = deferred();
  const release = deferred();
  let held = false;
  const heldDb = new Proxy(db, {
    get(target, property) {
      if (property === 'batch') {
        return async (...args: Parameters<typeof db.batch>) => {
          if (!held) {
            held = true;
            started.resolve();
            await release.promise;
          }
          return target.batch(...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { heldDb, started: started.promise, release: release.resolve };
}

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
    const authoring = await getCourseAuthoringDomain(db, result.user.id, result.defaultCourse!.id);
    expect(authoring.experiences.some((experience) => experience.content.kind === 'worked' && 'solution' in experience.content)).toBe(true);
    expect(domain.experiences.some((experience) => typeof experience.content === 'object' && experience.content !== null && 'solution' in experience.content)).toBe(false);
    expect(domain.modules).toHaveLength(5);
    expect(domain.kcs).toHaveLength(14);
    expect(domain.experiences).toHaveLength(10);
    for (const module of domain.modules) {
      const moduleTargets = new Set(module.kc_ids);
      const moduleExperiences = domain.experiences.filter((experience) => module.experience_ids.includes(experience.id));
      const scaffold = moduleExperiences.find((experience) => experience.kind === 'scaffold')!;
      expect(scaffold.target_kc_ids.every((id) => moduleTargets.has(id))).toBe(true);
      expect(scaffold.target_kc_ids).toHaveLength(module.kc_ids.length);
    }
    expect(domain.modules.map((module) => module.title)).toEqual([
      'How do you know you’ve learned something?',
      'How do you access what you’ve learned?',
      'What does learning feel like?',
      'What helps you learn best?',
      'How can you keep getting better at learning?',
    ]);
    const scaffold = domain.experiences.find((experience) => {
      const content = experience.content as { kind?: string; level?: number };
      return experience.kind === 'scaffold' && content.kind === 'scaffold' && content.level === 1;
    })!;
    const weakEvidence = domain.experiences.find((experience) => experience.evidence?.target_kc_ids.includes(scaffold.target_kc_ids[0]))!;
    await createEvent(db, result.user.id, {
      type: 'quiz_taken', kc_id: scaffold.target_kc_ids[0], experience_id: weakEvidence.id,
      payload: { correct: false },
    });
    const supported = await getNextExperience(db, result.user.id);
    expect(supported.experience.kind).toBe('scaffold');
    expect(domain.experiences.find((experience) => experience.id === supported.experience.id)?.target_kc_ids).toContain(scaffold.target_kc_ids[0]);
  });

  it('returns the same learner and course on sequential retries', async () => {
    const identity = { id: 'clerk-bootstrap-repeat', primaryEmailAddress: 'bootstrap-repeat@example.test' };
    const first = await provisionLearner(db, identity);
    const sequential = await resolveLocalUser(db, identity);

    expect(sequential).toMatchObject({ wasCreated: false, user: { id: first.user.id }, defaultCourse: { id: first.defaultCourse.id } });
  });

  it('offers a persisted default-course retention experience when review is due', async () => {
    const now = Date.now();
    const learner = await resolveLocalUser(db, { id: 'clerk-bootstrap-retention', primaryEmailAddress: 'retention@example.test' });
    const domain = await getCourseDomain(db, learner.user.id, learner.defaultCourse!.id);
    const retention = domain.experiences.find((experience) => {
      const content = experience.content as { selection_policy?: { evidence_tags: string[] } };
      return content.selection_policy?.evidence_tags.includes('spacing');
    })!;
    const targetKcId = retention.evidence!.target_kc_ids[0];
    await createEvent(db, learner.user.id, {
      type: 'quiz_taken', kc_id: targetKcId, experience_id: retention.id,
      ts: new Date(now - 3 * 86_400_000).toISOString(), payload: { correct: true },
    });
    await createEvent(db, learner.user.id, {
      type: 'quiz_taken', kc_id: targetKcId, experience_id: retention.id,
      ts: new Date(now - 2 * 86_400_000).toISOString(), payload: { correct: true, evidence_tags: ['transfer'] },
    });

    const next = await getNextExperience(db, learner.user.id, now);
    expect(next.reasons[0], JSON.stringify(next)).toMatch(/^spaced review due for /);
    const selectedContent = next.experience.content as { selection_policy?: { evidence_tags: string[] } };
    expect(selectedContent.selection_policy?.evidence_tags).toContain('retention');
  });

  it('records default-course rubric responses without trusting learner self-grading', async () => {
    const learner = await resolveLocalUser(db, { id: 'clerk-bootstrap-observation', primaryEmailAddress: 'observation@example.test' });
    const domain = await getCourseDomain(db, learner.user.id, learner.defaultCourse!.id);
    const experience = domain.experiences.find((row) => {
      const content = row.content as { selection_policy?: { evidence_tags?: string[] } };
      return row.evidence?.diagnostic_misconception_ids.length && content.selection_policy?.evidence_tags?.includes('retention') && content.selection_policy.evidence_tags.includes('transfer');
    })!;
    const kcId = experience.evidence!.target_kc_ids[0];
    const before = await getKcState(db, learner.user.id, kcId);
    for (const response of ['First response', 'Second response', 'Third response']) {
      await respondToExperience(db, learner.user.id, experience.id, { response });
    }
    const recorded = await db.select().from(events).where(eq(events.experienceId, experience.id));
    expect(recorded).toHaveLength(3);
    expect(recorded[0].source).toBe('system');
    expect(recorded[0].payload).toMatchObject({
      observation: true,
      evidence_tags: ['retention', 'transfer'],
      diagnostic_misconception_ids: experience.evidence!.diagnostic_misconception_ids,
    });
    expect(await getKcState(db, learner.user.id, kcId)).toMatchObject({ masteryEstimate: before.masteryEstimate, masteryStatus: before.masteryStatus });
  });

  it('recovers the delayed resolver from a real bootstrap conflict', async () => {
    const identity = { id: 'clerk-bootstrap-concurrent', primaryEmailAddress: 'bootstrap-concurrent@example.test' };
    const held = holdNextBatch();
    const delayed = resolveLocalUser(held.heldDb, identity);
    await held.started;

    const winner = await resolveLocalUser(db, identity);
    held.release();
    const recovered = await delayed;

    expect(winner.wasCreated).toBe(true);
    expect(winner.defaultCourse).not.toBeNull();
    expect(recovered).toMatchObject({ wasCreated: false, user: { id: winner.user.id }, defaultCourse: { id: winner.defaultCourse!.id } });
    expect(await db.select().from(courses).where(eq(courses.userId, winner.user.id))).toHaveLength(1);
  });

  it('fails a delayed bootstrap closed when deletion is fenced before its commit', async () => {
    const identity = { id: 'clerk-bootstrap-delete-race', primaryEmailAddress: 'bootstrap-delete-race@example.test' };
    const held = holdNextBatch();
    const delayed = resolveLocalUser(held.heldDb, identity);
    await held.started;

    await enqueueAccountDeletion(db, { eventId: 'evt-bootstrap-delete-race', clerkUserId: identity.id }, 1_000);
    held.release();

    await expect(delayed).rejects.toBeInstanceOf(AccountInactiveError);
    expect(await db.select().from(users).where(eq(users.clerkUserId, identity.id))).toEqual([]);
    expect(await db.select().from(courses)).toEqual([]);
    expect(await db.select().from(learnerRuntimeRegistry)).toEqual([]);
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
