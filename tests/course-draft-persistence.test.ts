import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import {
  courseOutcomes,
  courseReferences,
  courses,
  exampleKcs,
  experiences,
  kcExamples,
  kcs,
  outcomeKcs,
  users,
} from '../src/db/schema';
import { getCourseDomain, persistCourseDraft } from '../src/lib/services/courseDraft';

const db = getDb(env.DB);
let userId: string;
let otherUserId: string;

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
  examples: [{ id: 'example-evidence', kc_ids: ['kc-evidence'], content: { contrast: 'Recall versus rereading' } }],
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
        response_type: 'constructed_response' as const,
        target_kc_ids: ['kc-evidence'],
        diagnostic_misconception_ids: ['misconception-fluency'],
        scoring: { kind: 'rubric' as const, details: { answer: 'Use delayed retrieval', rubric: 'Evidence-based explanation' } },
      },
      content: {
        kind: 'worked',
        prompt: 'Predict, then retrieve.',
        solution: 'Use delayed retrieval',
        source: 'Course author',
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
};

beforeEach(async () => {
  userId = crypto.randomUUID();
  otherUserId = crypto.randomUUID();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test.local`, passwordHash: 'clerk-managed' },
    { id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'clerk-managed' },
  ]);
});

describe('course draft persistence', () => {
  it('deep-copies the complete aggregate with fresh relational IDs', async () => {
    const saved = await persistCourseDraft(db, userId, draft, {
      sourceTemplateKey: 'learning-how-to-learn',
      sourceTemplateVersion: '2026-09-12',
      bootstrapKey: 'default:2026-09-12',
    });

    expect(saved.slug).toBe('learning-how-to-learn');
    expect(saved.courseId).not.toBe(draft.outcomes[0].id);
    expect(await db.select().from(courses).where(and(eq(courses.id, saved.courseId), eq(courses.userId, userId)))).toHaveLength(1);

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
    expect(domain.experiences[0].content).toEqual({ kind: 'worked', prompt: 'Predict, then retrieve.', source: 'Course author' });
    expect(domain.experiences[0].evidence?.scoring?.details).toEqual({ rubric: 'Evidence-based explanation' });
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
});
