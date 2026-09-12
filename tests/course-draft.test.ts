import { describe, expect, it } from 'vitest';
import { CourseDraftValidationError, validateCourseDraft } from '../src/lib/domain/courseDraft';
import { courseDraftV2Schema } from '../src/lib/schemas/courseDraft';

export const validDraft = {
  schema_version: 2,
  spec: {
    title: 'Learning how to learn',
    topic: 'Learning how to learn',
    level: 'beginner',
  },
  outcomes: [{ id: 'outcome-evidence', title: 'Use evidence to judge learning', kc_ids: ['kc-evidence'] }],
  kcs: [
    {
      id: 'kc-evidence',
      name: 'Evidence beats confidence',
      kc_form: 'variable_constant',
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
      positive: 'Recall an answer before checking it.',
      negative: 'Reread until the answer feels familiar.',
      explanation: 'Retrieval provides stronger evidence than familiarity.',
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
      kind: 'exercise',
      target_kc_ids: ['kc-evidence'],
      intended_processes: ['induction_refinement'],
      evidence: {
        response_type: 'constructed_response',
        target_kc_ids: ['kc-evidence'],
        diagnostic_misconception_ids: ['misconception-fluency'],
        scoring: {
          kind: 'rubric' as const,
          details: {
            schema_version: 1,
            criteria: [{ id: 'evidence', label: 'Uses evidence', description: 'Names delayed retrieval as evidence.' }],
          },
        },
      },
      content: {
        schema_version: 1,
        kind: 'worked' as const,
        prompt: 'Predict, then retrieve.',
        solution: 'Compare the prediction with delayed retrieval.',
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
};

describe('CourseDraftV2 schema', () => {
  it('parses a minimal valid draft', () => {
    expect(courseDraftV2Schema.parse(validDraft).spec.topic).toBe('Learning how to learn');
  });

  it('accepts a mastery rule with every optional field omitted', () => {
    expect(courseDraftV2Schema.parse({
      ...validDraft,
      kcs: [{ ...validDraft.kcs[0], mastery_rule: {} }],
    }).kcs[0].mastery_rule).toEqual({});
  });

  it('rejects unknown keys', () => {
    expect(() => courseDraftV2Schema.parse({ ...validDraft, surprise: true })).toThrow();
  });

  it.each([
    ['kc form', { ...validDraft, kcs: [{ ...validDraft.kcs[0], kc_form: 'fact' }] }],
    ['process', { ...validDraft, experiences: [{ ...validDraft.experiences[0], intended_processes: ['reviewing'] }] }],
    ['experience kind', { ...validDraft, experiences: [{ ...validDraft.experiences[0], kind: 'lecture' }] }],
  ])('rejects an invalid %s enum', (_label, draft) => {
    expect(() => courseDraftV2Schema.parse(draft)).toThrow();
  });

  it('rejects an evidence contract without a target', () => {
    expect(() => courseDraftV2Schema.parse(invalidDraft((draft) => {
      draft.experiences[0].evidence.target_kc_ids = [];
    }))).toThrow();
  });

  it.each([
    ['example content', invalidDraft((draft) => { draft.examples[0].content = { contrast: 'unversioned' } as never; })],
    ['experience content', invalidDraft((draft) => { draft.experiences[0].content = { prompt: 'unversioned' } as never; })],
    ['scoring details', invalidDraft((draft) => {
      draft.experiences[0].evidence.scoring!.details = { rubric: 'unversioned' } as never;
    })],
  ])('rejects unversioned %s', (_label, invalid) => {
    expect(() => courseDraftV2Schema.parse(invalid)).toThrow();
  });

  it('accepts strict scaffold, project, and explicitly generic versioned content', () => {
    const withVariants = invalidDraft((value) => {
      value.examples[0].content = { schema_version: 1, kind: 'generic', data: { caption: 'A bounded extension' } } as never;
      value.experiences.push(
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
    });
    expect(courseDraftV2Schema.parse(withVariants).experiences).toHaveLength(3);
  });

  it('accepts strict machine-readable experience selection policy', () => {
    const withPolicy = invalidDraft((value) => {
      value.experiences[0].content = {
        ...value.experiences[0].content,
        selection_policy: { evidence_tags: ['spacing', 'retention', 'transfer'] },
      } as never;
    });
    expect(courseDraftV2Schema.parse(withPolicy).experiences[0].content).toMatchObject({
      selection_policy: { evidence_tags: ['spacing', 'retention', 'transfer'] },
    });
  });

  it.each([
    ['top-level collection', invalidDraft((value) => { value.outcomes = Array.from({ length: 101 }, (_, index) => ({ ...value.outcomes[0], id: `outcome-${index}` })); })],
    ['relationship collection', invalidDraft((value) => { value.outcomes[0].kc_ids = Array.from({ length: 301 }, () => 'kc-evidence'); })],
    ['string field', invalidDraft((value) => { value.spec.title = 'x'.repeat(201); })],
    ['generic content payload', invalidDraft((value) => { value.examples[0].content = { schema_version: 1, kind: 'generic', data: { body: 'x'.repeat(65_537) } } as never; })],
  ])('rejects an oversized %s at the authenticated draft boundary', (_label, oversized) => {
    expect(() => courseDraftV2Schema.parse(oversized)).toThrow();
  });

  it('rejects an oversized aggregate even when each collection is under its own cap', () => {
    const oversized = invalidDraft((value) => {
      value.outcomes = Array.from({ length: 100 }, (_, index) => ({ ...value.outcomes[0], id: `outcome-${index}` }));
      value.kcs = Array.from({ length: 300 }, (_, index) => ({ ...value.kcs[0], id: `kc-${index}` }));
      value.examples = Array.from({ length: 500 }, (_, index) => ({ ...value.examples[0], id: `example-${index}` }));
      value.experiences = Array.from({ length: 101 }, (_, index) => ({ ...value.experiences[0], id: `experience-${index}` }));
    });
    expect(() => courseDraftV2Schema.parse(oversized)).toThrow(/aggregate/i);
  });

  it('keeps observation evidence unscored', () => {
    const observation = invalidDraft((value) => {
      value.experiences[0].evidence.response_type = 'observation';
      delete (value.experiences[0].evidence as { scoring?: unknown }).scoring;
    });
    expect(courseDraftV2Schema.parse(observation).experiences[0].evidence?.scoring).toBeUndefined();
  });
});

function invalidDraft(mutator: (draft: typeof validDraft) => void): typeof validDraft {
  const draft = structuredClone(validDraft);
  mutator(draft);
  return draft;
}

describe('validateCourseDraft', () => {
  it.each([
    ['requires every outcome to target a KC', invalidDraft((draft) => { draft.outcomes[0].kc_ids = []; }), ['outcomes', 0, 'kc_ids']],
    ['requires a non-empty example collection', invalidDraft((draft) => { draft.examples = []; }), ['examples']],
    ['requires evidence-producing experience for every KC', invalidDraft((draft) => { delete (draft.experiences[0] as { evidence?: unknown }).evidence; }), ['kcs', 0]],
    ['requires intended processes on an experience', invalidDraft((draft) => { draft.experiences[0].intended_processes = []; }), ['experiences', 0, 'intended_processes']],
    ['rejects dangling references', invalidDraft((draft) => { draft.references[0].kc_ids = ['missing-kc']; }), ['references', 0, 'kc_ids', 0]],
    [
      'keeps diagnostic misconceptions within experience targets',
      invalidDraft((draft) => {
        draft.experiences[0].evidence.target_kc_ids = ['another-kc'];
      }),
      ['experiences', 0, 'evidence', 'target_kc_ids', 0],
    ],
    [
      'rejects prerequisite cycles',
      invalidDraft((draft) => {
        (draft.kcs as Array<Record<string, unknown>>).push({ ...draft.kcs[0], id: 'another-kc', prerequisite_kc_ids: ['kc-evidence'] });
        (draft.kcs[0].prerequisite_kc_ids as string[]) = ['another-kc'];
      }),
      ['kcs'],
    ],
  ])('%s', (_name, draft, path) => {
    expect(() => validateCourseDraft(draft)).toThrow(CourseDraftValidationError);
    try {
      validateCourseDraft(draft);
    } catch (error) {
      expect(error).toBeInstanceOf(CourseDraftValidationError);
      expect((error as CourseDraftValidationError).issues.some((issue) => issue.path.join('.') === path.join('.'))).toBe(true);
    }
  });

  it('returns the parsed draft', () => {
    expect(validateCourseDraft(validDraft).spec.title).toBe('Learning how to learn');
  });

  it('rejects an empty course aggregate', () => {
    const draft = invalidDraft((value) => {
      value.outcomes = [];
      value.kcs = [];
      value.examples = [];
      value.experiences = [];
      value.misconceptions = [];
      value.references = [];
    });
    expect(() => validateCourseDraft(draft)).toThrow(CourseDraftValidationError);
  });

  it.each([
    ['outcomes', 'kc_ids'],
    ['kcs', 'prerequisite_kc_ids'],
    ['examples', 'kc_ids'],
    ['misconceptions', 'kc_ids'],
    ['experiences', 'target_kc_ids'],
    ['experiences', 'evidence.target_kc_ids'],
    ['experiences', 'evidence.diagnostic_misconception_ids'],
    ['references', 'kc_ids'],
    ['references', 'example_ids'],
    ['references', 'experience_ids'],
    ['references', 'misconception_ids'],
  ])('rejects duplicate persistence links in %s.%s', (collection, relationship) => {
    const draft = invalidDraft((value) => {
      const entity = value[collection as 'outcomes' | 'kcs' | 'examples' | 'misconceptions' | 'experiences' | 'references'][0] as Record<string, unknown>;
      const [parent, child] = relationship.split('.');
      if (child) {
        const evidence = entity[parent] as Record<string, unknown>;
        const ids = evidence[child] as string[];
        evidence[child] = [ids[0] ?? 'kc-evidence', ids[0] ?? 'kc-evidence'];
      } else {
        const ids = entity[parent] as string[];
        entity[parent] = [ids[0] ?? 'kc-evidence', ids[0] ?? 'kc-evidence'];
      }
    });
    try {
      validateCourseDraft(draft);
      throw new Error('Expected duplicate links to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(CourseDraftValidationError);
      expect((error as CourseDraftValidationError).issues.some((issue) => issue.code === 'duplicate_link')).toBe(true);
    }
  });

  it('normalizes schema failures to stable paths and codes', () => {
    try {
      validateCourseDraft({});
      throw new Error('Expected schema validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CourseDraftValidationError);
      expect((error as CourseDraftValidationError).issues[0]).toMatchObject({
        path: ['schema_version'],
        code: 'schema_invalid',
        message: 'Invalid course draft value',
      });
    }
  });
});
