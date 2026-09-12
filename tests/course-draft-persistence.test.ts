import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import {
  courseOutcomes,
  courseReferences,
  courses,
  exampleKcs,
  experienceKcs,
  experienceMisconceptions,
  experiences,
  exercises,
  events,
  moduleExperiences,
  referenceExperiences,
  scaffolds,
  kcExamples,
  kcs,
  outcomeKcs,
  users,
} from '../src/db/schema';
import { getCourseAuthoringDomain, getCourseDomain, persistCourseDraft, reviseCourseDraft } from '../src/lib/services/courseDraft';
import { respondToExperience } from '../src/lib/services/events';
import type { CourseDraftV2 } from '../src/lib/schemas/courseDraft';
import { loadDefaultCourse } from '../src/lib/content/defaultCourse';

const db = getDb(env.DB);
let userId: string;
let otherUserId: string;

function holdNextBatch() {
  let release!: () => void; let started!: () => void;
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  let held = false;
  const heldDb = new Proxy(db, { get(target, property) {
    if (property === 'batch') return async (...args: Parameters<typeof db.batch>) => {
      if (!held) { held = true; started(); await releasePromise; }
      return target.batch(...args);
    };
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { heldDb, started: startedPromise, release };
}

const draft = {
  schema_version: 2 as const,
  spec: {
    title: 'Learning how to learn',
    topic: 'Learning how to learn',
    level: 'beginner',
    project: 'Build a durable study plan',
    constraints: ['Twenty minutes per day'],
  },
  outcomes: [{ id: 'outcome-evidence', title: 'Use evidence to judge learning', kc_ids: ['kc-evidence'] }],
  kcs: [
    {
      id: 'kc-evidence',
      name: 'Evidence beats confidence',
      kc_form: 'variable_constant' as const,
      rationale_level: 2,
      mastery_rule: { threshold: 0.8, minimum_evidence: 2 },
      prerequisite_kc_ids: [],
    },
  ],
  examples: [{
    id: 'example-evidence',
    kc_ids: ['kc-evidence'],
    content: {
      schema_version: 1,
      kind: 'contrast' as const,
      positive: 'Recall before checking.',
      negative: 'Reread until familiar.',
      explanation: 'Retrieval produces stronger evidence.',
    },
  }],
  misconceptions: [
    {
      id: 'misconception-fluency',
      kc_ids: ['kc-evidence'],
      name: 'Fluency means mastery',
      diagnostic_probe: 'Does familiarity prove you can retrieve it later?',
      correction: 'Only later performance is evidence of retention.',
    },
  ],
  experiences: [
    {
      id: 'experience-retrieval',
      kind: 'exercise' as const,
      target_kc_ids: ['kc-evidence'],
      intended_processes: ['induction_refinement' as const],
      evidence: {
        response_type: 'selected_response' as const,
        target_kc_ids: ['kc-evidence'],
        diagnostic_misconception_ids: ['misconception-fluency'],
        scoring: {
          kind: 'binary' as const,
          details: {
            schema_version: 1,
            correct_response: 1,
          },
        },
      },
      content: {
        schema_version: 1,
        kind: 'mcq' as const,
        prompt: 'Which action provides stronger evidence?',
        options: ['Reread', 'Retrieve later'],
        correct_index: 1,
        explanation: 'Delayed retrieval tests access without the answer visible.',
        source: 'Course author',
        difficulty: 2,
      },
    },
  ],
  references: [
    {
      id: 'reference-kli',
      citation: 'Koedinger et al., Knowledge-Learning-Instruction framework',
      url: 'https://example.test/kli',
      kc_ids: ['kc-evidence'],
      example_ids: ['example-evidence'],
      experience_ids: ['experience-retrieval'],
      misconception_ids: ['misconception-fluency'],
    },
  ],
  modules: [
    {
      id: 'module-evidence',
      title: 'How do you know you learned?',
      outcome_ids: ['outcome-evidence'],
      kc_ids: ['kc-evidence'],
      experience_ids: ['experience-retrieval'],
      sort_order: 0,
    },
  ],
} satisfies CourseDraftV2;

beforeEach(async () => {
  userId = crypto.randomUUID();
  otherUserId = crypto.randomUUID();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test.local`, passwordHash: 'clerk-managed' },
    { id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'clerk-managed' },
  ]);
});

describe('course draft persistence', () => {
  it('separates learner-safe content from full authoring content and scores MCQ responses server-side', async () => {
    const saved = await persistCourseDraft(db, userId, draft);
    const learner = await getCourseDomain(db, userId, saved.courseId);
    const author = await getCourseAuthoringDomain(db, userId, saved.courseId);
    expect(learner.experiences[0].content).not.toHaveProperty('correct_index');
    expect(author.experiences[0].content).toMatchObject({ kind: 'mcq', correct_index: 1 });
    await respondToExperience(db, userId, author.experiences[0].id, { selected_index: 1 });
    expect((await db.select().from(events).where(eq(events.experienceId, author.experiences[0].id)))[0].payload).toMatchObject({ correct: true, selected_index: 1 });
  });
  it('does not score a selected response whose evidence contract has no supported scorer', async () => {
    const unscored = structuredClone(draft) as CourseDraftV2;
    unscored.experiences[0].evidence!.scoring = {
      kind: 'rubric',
      details: { schema_version: 1, criteria: [{ id: 'reason', label: 'Gives a reason' }] },
    };
    const saved = await persistCourseDraft(db, userId, unscored);
    const experience = (await getCourseAuthoringDomain(db, userId, saved.courseId)).experiences[0];
    await respondToExperience(db, userId, experience.id, { selected_index: 1 });
    const event = (await db.select().from(events).where(eq(events.experienceId, experience.id)))[0];
    expect(event.type).toBe('practice_done');
    expect(event.payload).toMatchObject({ selected_index: 1, observation: true });
    expect(event.payload).not.toHaveProperty('correct');
  });
  it('records unsupported scoring formats without manufacturing correctness', async () => {
    const unscored = structuredClone(draft) as CourseDraftV2;
    unscored.experiences[0].evidence!.response_type = 'observation';
    delete unscored.experiences[0].evidence!.scoring;
    unscored.experiences[0].content = {
      schema_version: 1,
      kind: 'worked',
      prompt: 'Describe a retrieval plan.',
      solution: 'Attempt before reviewing, then return later.',
    };
    const saved = await persistCourseDraft(db, userId, unscored);
    const experience = (await getCourseAuthoringDomain(db, userId, saved.courseId)).experiences[0];
    await respondToExperience(db, userId, experience.id, { response: 'I will attempt first.' });
    const event = (await db.select().from(events).where(eq(events.experienceId, experience.id)))[0];
    expect(event.type).toBe('practice_done');
    expect(event.payload).toMatchObject({ response: 'I will attempt first.', observation: true });
    expect(event.payload).not.toHaveProperty('correct');
  });
  it('edits in place while preserving metadata, provenance, KC IDs, and event history', async () => {
    const first = await persistCourseDraft(db, userId, draft, { sourceTemplateKey: 'source', sourceTemplateVersion: '9', bootstrapKey: 'bootstrap', term: 'Fall', instructor: 'Teacher' });
    const edited = await getCourseAuthoringDomain(db, userId, first.courseId);
    const stableKcId = edited.kcs[0].id;
    await respondToExperience(db, userId, edited.experiences[0].id, { selected_index: 1 });
    edited.spec.title = 'Edited learning course'; edited.kcs[0].name = 'Edited evidence';
    delete edited.experiences[0].evidence!.scoring;
    const revised = await reviseCourseDraft(db, userId, first.courseId, edited, 0);
    expect(revised.courseId).toBe(first.courseId);
    const row = (await db.select().from(courses).where(eq(courses.id, first.courseId)))[0];
    expect(row).toMatchObject({ archived: false, term: 'Fall', instructor: 'Teacher', sourceTemplateKey: 'source', sourceTemplateVersion: '9', bootstrapKey: 'bootstrap' });
    const updated = await getCourseAuthoringDomain(db, userId, first.courseId);
    expect(updated.kcs[0]).toMatchObject({ id: stableKcId, name: 'Edited evidence' });
    expect(updated.experiences[0].evidence!.scoring).toBeUndefined();
    expect((await db.select().from(events).where(eq(events.kcId, stableKcId)))).toHaveLength(1);
    await expect(reviseCourseDraft(db, userId, first.courseId, edited, 0)).rejects.toThrow();
  });
  it('lets only one concurrent writer commit the expected revision', async () => {
    const saved = await persistCourseDraft(db, userId, draft);
    const left = await getCourseAuthoringDomain(db, userId, saved.courseId); left.spec.title = 'Left edit';
    const right = structuredClone(left); right.spec.title = 'Right edit';
    const held = holdNextBatch();
    const delayed = reviseCourseDraft(held.heldDb, userId, saved.courseId, left, 0);
    await held.started;
    await reviseCourseDraft(db, userId, saved.courseId, right, 0);
    held.release();
    await expect(delayed).rejects.toThrow();
    expect((await getCourseAuthoringDomain(db, userId, saved.courseId)).spec.title).toBe('Right edit');
  });
  it('rejects structural ID-set changes on the in-place authoring path', async () => {
    const saved = await persistCourseDraft(db, userId, draft);
    const edited = await getCourseAuthoringDomain(db, userId, saved.courseId);
    const priorId = edited.kcs[0].id;
    const replacementId = 'replacement-kc';
    edited.kcs[0].id = replacementId;
    edited.outcomes[0].kc_ids = [replacementId];
    edited.examples[0].kc_ids = [replacementId];
    edited.misconceptions[0].kc_ids = [replacementId];
    edited.experiences[0].target_kc_ids = [replacementId];
    edited.experiences[0].evidence!.target_kc_ids = [replacementId];
    edited.references[0].kc_ids = [replacementId];
    edited.modules[0].kc_ids = [replacementId];
    await expect(reviseCourseDraft(db, userId, saved.courseId, edited, 0)).rejects.toThrow(/Structural edits/);
    expect((await getCourseAuthoringDomain(db, userId, saved.courseId)).kcs[0].id).toBe(priorId);
  });
  it('keeps specialized scaffold and exercise rows synchronized during stable-ID edits', async () => {
    const saved = await persistCourseDraft(db, userId, loadDefaultCourse());
    const edited = await getCourseAuthoringDomain(db, userId, saved.courseId);
    const scaffold = edited.experiences.find((row) => row.kind === 'scaffold')!;
    const exercise = edited.experiences.find((row) => row.kind === 'exercise')!;
    const [priorScaffold] = await db.select().from(scaffolds).where(eq(scaffolds.experienceId, scaffold.id));
    const [priorExercise] = await db.select().from(exercises).where(eq(exercises.experienceId, exercise.id));
    if (scaffold.content.kind !== 'scaffold' || exercise.content.kind !== 'worked') throw new Error('Expected default specialized content');
    scaffold.content.scaffold_kind = 'mnemonic';
    scaffold.content.level = 3;
    scaffold.content.title = 'Edited scaffold';
    scaffold.content.body = 'Edited scaffold body.';
    exercise.content.prompt = 'Edited exercise prompt.';
    exercise.content.difficulty = 3;
    exercise.content.source = 'Edited author';
    exercise.content.selection_policy = { evidence_tags: ['transfer'] };

    await reviseCourseDraft(db, userId, saved.courseId, edited, 0);
    const [updatedScaffold] = await db.select().from(scaffolds).where(eq(scaffolds.experienceId, scaffold.id));
    const [updatedExercise] = await db.select().from(exercises).where(eq(exercises.experienceId, exercise.id));
    expect(updatedScaffold).toMatchObject({ id: priorScaffold.id, kind: 'mnemonic', level: 3, title: 'Edited scaffold', body: 'Edited scaffold body.' });
    expect(updatedExercise).toMatchObject({ id: priorExercise.id, kind: 'worked', difficulty: 3, prompt: 'Edited exercise prompt.', source: 'Edited author' });
    expect(updatedExercise.details).toMatchObject({ selection_policy: { evidence_tags: ['transfer'] } });
  });
  it('removes MCQ answers and explanations from the browser-safe read model', async () => {
    const saved = await persistCourseDraft(db, userId, draft);
    const domain = await getCourseDomain(db, userId, saved.courseId);
    expect(domain.experiences[0].content).not.toHaveProperty('correct_index');
    expect(domain.experiences[0].content).not.toHaveProperty('explanation');
  });

  it('projects only explicit browser-safe fields from structured and generic content', async () => {
    const riskyDraft = structuredClone(draft) as CourseDraftV2;
    riskyDraft.examples[0].content = {
      schema_version: 1,
      kind: 'generic',
      data: {
        publicText: 'This generic payload has no declared browser-safe fields.',
        answerKey: 'secret',
        nested: { correctIndex: 1, unknownSecret: 'nested secret' },
      },
    };
    const saved = await persistCourseDraft(db, userId, riskyDraft);
    const [savedExperience] = await db.select().from(experiences).where(eq(experiences.courseId, saved.courseId));
    await env.DB.prepare('UPDATE experiences SET content = ? WHERE id = ?').bind(JSON.stringify({
      schema_version: 1,
      kind: 'mcq',
      prompt: 'Safe prompt',
      options: ['First', 'Second'],
      difficulty: 2,
      source: 'Safe source',
      answerKey: 'secret',
      correctIndex: 1,
      nested: { unknownSecret: 'nested secret', answerKey: 'nested answer' },
    }), savedExperience.id).run();

    const domain = await getCourseDomain(db, userId, saved.courseId);
    expect(domain.examples[0].content).toEqual({ schema_version: 1, kind: 'generic', data: {} });
    expect(domain.experiences[0].content).toEqual({
      schema_version: 1,
      kind: 'mcq',
      prompt: 'Safe prompt',
      options: ['First', 'Second'],
      difficulty: 2,
      source: 'Safe source',
    });
  });

  it('deep-copies the complete aggregate with fresh relational IDs', async () => {
    const policyDraft = structuredClone(draft) as CourseDraftV2;
    policyDraft.experiences[0].content.selection_policy = { evidence_tags: ['spacing', 'retention'] };
    const saved = await persistCourseDraft(db, userId, policyDraft, {
      sourceTemplateKey: 'learning-how-to-learn',
      sourceTemplateVersion: '2026-09-12',
      bootstrapKey: 'default:2026-09-12',
    });

    expect(saved.slug).toBe('learning-how-to-learn');
    expect(saved.courseId).not.toBe(draft.outcomes[0].id);
    const [savedCourse] = await db.select().from(courses).where(and(eq(courses.id, saved.courseId), eq(courses.userId, userId)));
    expect(savedCourse).toMatchObject({ domainVersion: 2 });

    const savedOutcomes = await db.select().from(courseOutcomes).where(eq(courseOutcomes.courseId, saved.courseId));
    const savedKcs = await db.select().from(kcs).where(eq(kcs.courseId, saved.courseId));
    const savedExamples = await db.select().from(kcExamples).where(eq(kcExamples.courseId, saved.courseId));
    const savedExperiences = await db.select().from(experiences).where(eq(experiences.courseId, saved.courseId));
    const savedReferences = await db.select().from(courseReferences).where(eq(courseReferences.courseId, saved.courseId));

    expect(savedOutcomes).toHaveLength(1);
    expect(savedKcs).toHaveLength(1);
    expect(savedExamples).toHaveLength(1);
    expect(savedExperiences).toHaveLength(1);
    expect(savedReferences).toHaveLength(1);
    expect(savedKcs[0]).toMatchObject({ kcForm: 'variable_constant', kcType: 'concept', rationaleLevel: 2 });
    expect(savedKcs[0].id).not.toBe('kc-evidence');
    expect(savedOutcomes[0].id).not.toBe('outcome-evidence');
    expect(savedExamples[0].id).not.toBe('example-evidence');
    expect(savedExperiences[0].id).not.toBe('experience-retrieval');
    expect(savedReferences[0].id).not.toBe('reference-kli');
    expect(await db.select().from(outcomeKcs).where(eq(outcomeKcs.outcomeId, savedOutcomes[0].id))).toHaveLength(1);
    expect(await db.select().from(exampleKcs).where(eq(exampleKcs.exampleId, savedExamples[0].id))).toHaveLength(1);

    const domain = await getCourseDomain(db, userId, saved.courseId);
    expect(domain).toMatchObject({ schema_version: 2, spec: draft.spec });
    expect(domain.outcomes[0].kc_ids).toEqual([savedKcs[0].id]);
    expect(domain.modules[0].experience_ids).toEqual([savedExperiences[0].id]);
    expect(domain.experiences[0].content).toEqual({
      schema_version: 1,
      kind: 'mcq',
      selection_policy: { evidence_tags: ['spacing', 'retention'] },
      prompt: 'Which action provides stronger evidence?',
      options: ['Reread', 'Retrieve later'],
      source: 'Course author',
      difficulty: 2,
    });
    expect(domain.experiences[0].content).not.toHaveProperty('explanation');
    expect(domain.experiences[0].evidence?.scoring?.details).toEqual({ schema_version: 1 });
  });

  it('rolls back the whole batch when any statement fails', async () => {
    await persistCourseDraft(db, userId, draft, { bootstrapKey: 'same-bootstrap' });
    const before = await db.select().from(courses).where(eq(courses.userId, userId));
    const outcomesBefore = await db.select().from(courseOutcomes);
    const experiencesBefore = await db.select().from(experiences);

    await expect(persistCourseDraft(db, userId, draft, { bootstrapKey: 'same-bootstrap' })).rejects.toThrow();

    expect(await db.select().from(courses).where(eq(courses.userId, userId))).toHaveLength(before.length);
    expect(await db.select().from(courseOutcomes)).toHaveLength(outcomesBefore.length);
    expect(await db.select().from(experiences)).toHaveLength(experiencesBefore.length);
  });

  it('does not expose one learner course domain to another learner', async () => {
    const saved = await persistCourseDraft(db, userId, draft);
    await expect(getCourseDomain(db, otherUserId, saved.courseId)).rejects.toThrow('Course not found');
  });

  it('rejects an owned legacy course that is not a V2 aggregate', async () => {
    const legacyCourseId = crypto.randomUUID();
    await db.insert(courses).values({
      id: legacyCourseId,
      userId,
      code: 'LEGACY',
      slug: `legacy-${legacyCourseId}`,
      title: 'Legacy course',
    });
    await expect(getCourseDomain(db, userId, legacyCourseId)).rejects.toMatchObject({
      name: 'CourseDomainVersionError',
      message: 'Course domain version is not supported',
    });
  });

  it('rejects an owned course explicitly marked as domain V1', async () => {
    const legacyCourseId = crypto.randomUUID();
    await db.insert(courses).values({
      id: legacyCourseId,
      userId,
      code: 'V1',
      slug: `v1-${legacyCourseId}`,
      title: 'V1 course',
      domainVersion: 1,
    });
    await expect(getCourseDomain(db, userId, legacyCourseId)).rejects.toMatchObject({
      name: 'CourseDomainVersionError',
      message: 'Course domain version is not supported',
    });
  });

  it('rejects a prerequisite edge whose endpoints belong to different learners', async () => {
    const first = await persistCourseDraft(db, userId, draft);
    const second = await persistCourseDraft(db, otherUserId, draft);
    const own = await getCourseDomain(db, userId, first.courseId);
    const foreign = await getCourseDomain(db, otherUserId, second.courseId);

    await expect(env.DB.prepare(
      'INSERT INTO kc_edges(id,kc_id,prereq_kc_id,relation,source,created_at) VALUES(?,?,?,?,?,?)',
    ).bind(crypto.randomUUID(), own.kcs[0].id, foreign.kcs[0].id, 'prerequisite', 'seed', Date.now()).run())
      .rejects.toThrow('kc edge owner mismatch');
  });

  it('rejects every cross-course aggregate link at the database boundary', async () => {
    const first = await persistCourseDraft(db, userId, draft);
    const second = await persistCourseDraft(db, userId, { ...draft, spec: { ...draft.spec, title: 'Second course' } });
    const own = await getCourseDomain(db, userId, first.courseId);
    const foreign = await getCourseDomain(db, userId, second.courseId);
    const now = Date.now();
    const attempts: Array<[string, unknown[]]> = [
      ['INSERT INTO outcome_kcs(outcome_id,kc_id,course_id,sort_order,created_at) VALUES(?,?,?,?,?)', [own.outcomes[0].id, foreign.kcs[0].id, first.courseId, 1, now]],
      ['INSERT INTO example_kcs(example_id,kc_id,course_id,sort_order,created_at) VALUES(?,?,?,?,?)', [own.examples[0].id, foreign.kcs[0].id, first.courseId, 1, now]],
      ['INSERT INTO misconception_kcs(misconception_id,kc_id,course_id,sort_order,created_at) VALUES(?,?,?,?,?)', [own.misconceptions[0].id, foreign.kcs[0].id, first.courseId, 1, now]],
      ['INSERT INTO experience_kcs(experience_id,kc_id,course_id,is_evidence_target,sort_order,created_at) VALUES(?,?,?,?,?,?)', [own.experiences[0].id, foreign.kcs[0].id, first.courseId, 0, 1, now]],
      ['INSERT INTO experience_misconceptions(experience_id,misconception_id,course_id,sort_order,created_at) VALUES(?,?,?,?,?)', [own.experiences[0].id, foreign.misconceptions[0].id, first.courseId, 1, now]],
      ['INSERT INTO reference_kcs(reference_id,kc_id,course_id) VALUES(?,?,?)', [own.references[0].id, foreign.kcs[0].id, first.courseId]],
      ['INSERT INTO reference_examples(reference_id,example_id,course_id) VALUES(?,?,?)', [own.references[0].id, foreign.examples[0].id, first.courseId]],
      ['INSERT INTO reference_experiences(reference_id,experience_id,course_id) VALUES(?,?,?)', [own.references[0].id, foreign.experiences[0].id, first.courseId]],
      ['INSERT INTO reference_misconceptions(reference_id,misconception_id,course_id) VALUES(?,?,?)', [own.references[0].id, foreign.misconceptions[0].id, first.courseId]],
      ['INSERT INTO module_outcomes(module_id,outcome_id,course_id,sort_order) VALUES(?,?,?,?)', [own.modules[0].id, foreign.outcomes[0].id, first.courseId, 1]],
      ['INSERT INTO module_kcs(module_id,kc_id,course_id,sort_order) VALUES(?,?,?,?)', [own.modules[0].id, foreign.kcs[0].id, first.courseId, 1]],
      ['INSERT INTO module_experiences(module_id,experience_id,course_id,sort_order) VALUES(?,?,?,?)', [own.modules[0].id, foreign.experiences[0].id, first.courseId, 1]],
    ];

    for (const [sql, bindings] of attempts) {
      await expect(env.DB.prepare(sql).bind(...bindings).run()).rejects.toThrow(/FOREIGN KEY constraint failed/);
    }
  });

  it('rejects cross-course scaffold, exercise, and event experience links', async () => {
    const first = await persistCourseDraft(db, userId, draft);
    const second = await persistCourseDraft(db, userId, { ...draft, spec: { ...draft.spec, title: 'Trigger course' } });
    const own = await getCourseDomain(db, userId, first.courseId);
    const foreignExperienceId = crypto.randomUUID();
    await db.insert(experiences).values({
      id: foreignExperienceId,
      courseId: second.courseId,
      kind: 'project',
      intendedProcesses: ['understanding_sensemaking'],
      content: { schema_version: 1, kind: 'project', title: 'Foreign', brief: 'Foreign' },
    });
    const now = Date.now();

    await expect(env.DB.prepare(
      'INSERT INTO scaffolds(id,kc_id,experience_id,kind,level,title,body,details,sort_order,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(crypto.randomUUID(), own.kcs[0].id, foreignExperienceId, 'retrieval_prompt', 1, 'Mismatch', 'Mismatch', '{}', 0, 'user', now).run())
      .rejects.toThrow('scaffold experience course mismatch');
    await expect(env.DB.prepare(
      'INSERT INTO exercises(id,kc_id,experience_id,slug,kind,difficulty,prompt,details,source,origin,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(crypto.randomUUID(), own.kcs[0].id, foreignExperienceId, `mismatch-${crypto.randomUUID()}`, 'worked', 2, 'Mismatch', '{}', 'test', 'user', 0, now).run())
      .rejects.toThrow('exercise experience course mismatch');
    await expect(env.DB.prepare(
      'INSERT INTO events(id,user_id,ts,type,course_id,experience_id,payload,source,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    ).bind(crypto.randomUUID(), userId, now, 'mismatch', first.courseId, foreignExperienceId, '{}', 'system', now).run())
      .rejects.toThrow('event experience course mismatch');
  });

  it('rolls back when a late module link statement fails', async () => {
    const before = await db.select().from(courses).where(eq(courses.userId, userId));
    await env.DB.exec("CREATE TRIGGER fail_late_course_draft BEFORE INSERT ON module_experiences BEGIN SELECT RAISE(ABORT, 'late draft failure'); END");
    try {
      await expect(persistCourseDraft(db, userId, draft)).rejects.toThrow('late draft failure');
    } finally {
      await env.DB.exec('DROP TRIGGER fail_late_course_draft');
    }
    expect(await db.select().from(courses).where(eq(courses.userId, userId))).toHaveLength(before.length);
  });

  it('round-trips scaffold and project experiences with their links', async () => {
    const expanded = structuredClone(draft);
    expanded.experiences.push(
      {
        id: 'experience-scaffold',
        kind: 'scaffold',
        target_kc_ids: ['kc-evidence'],
        intended_processes: ['memory_fluency'],
        content: {
          schema_version: 1,
          kind: 'scaffold',
          scaffold_kind: 'retrieval_prompt',
          level: 1,
          title: 'Recall first',
          body: 'Try to recall the idea before looking.',
        },
      } as never,
      {
        id: 'experience-project',
        kind: 'project',
        target_kc_ids: ['kc-evidence'],
        intended_processes: ['understanding_sensemaking'],
        content: {
          schema_version: 1,
          kind: 'project',
          title: 'Learning evidence plan',
          brief: 'Plan a delayed check.',
          deliverable: 'A one-week plan.',
        },
      } as never,
    );
    expanded.references[0].experience_ids.push('experience-scaffold', 'experience-project');
    expanded.modules[0].experience_ids.push('experience-scaffold', 'experience-project');

    const saved = await persistCourseDraft(db, userId, expanded);
    const domain = await getCourseDomain(db, userId, saved.courseId);
    expect(domain.experiences.map((experience) => experience.kind)).toEqual(['exercise', 'scaffold', 'project']);
    expect(domain.references[0].experience_ids).toHaveLength(3);
    expect(domain.modules[0].experience_ids).toHaveLength(3);
    const [scaffold] = await db.select().from(scaffolds).innerJoin(experiences, eq(scaffolds.experienceId, experiences.id))
      .where(eq(experiences.courseId, saved.courseId));
    expect(scaffold.scaffolds).toMatchObject({ kind: 'retrieval_prompt', title: 'Recall first' });
    expect(await db.select().from(experienceKcs).where(eq(experienceKcs.courseId, saved.courseId))).toHaveLength(3);
    expect(await db.select().from(experienceMisconceptions).where(eq(experienceMisconceptions.courseId, saved.courseId))).toHaveLength(1);
    expect(await db.select().from(referenceExperiences).where(eq(referenceExperiences.courseId, saved.courseId))).toHaveLength(3);
    expect(await db.select().from(moduleExperiences).where(eq(moduleExperiences.courseId, saved.courseId))).toHaveLength(3);
  });
});
