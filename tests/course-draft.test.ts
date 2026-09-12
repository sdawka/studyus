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
      kind: 'exercise',
      target_kc_ids: ['kc-evidence'],
      intended_processes: ['induction_refinement'],
      produces_evidence: true,
      diagnostic_misconception_ids: ['misconception-fluency'],
      content: { prompt: 'Predict, then retrieve.' },
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
});

function invalidDraft(mutator: (draft: typeof validDraft) => void): typeof validDraft {
  const draft = structuredClone(validDraft);
  mutator(draft);
  return draft;
}

describe('validateCourseDraft', () => {
  it.each([
    ['requires every outcome to target a KC', invalidDraft((draft) => { draft.outcomes[0].kc_ids = []; }), ['outcomes', 0, 'kc_ids']],
    ['requires an example for every KC', invalidDraft((draft) => { draft.examples = []; }), ['kcs', 0]],
    ['requires evidence-producing experience for every KC', invalidDraft((draft) => { draft.experiences[0].produces_evidence = false; }), ['kcs', 0]],
    ['requires intended processes on an experience', invalidDraft((draft) => { draft.experiences[0].intended_processes = []; }), ['experiences', 0, 'intended_processes']],
    ['rejects dangling references', invalidDraft((draft) => { draft.references[0].kc_ids = ['missing-kc']; }), ['references', 0, 'kc_ids', 0]],
    [
      'keeps diagnostic misconceptions within experience targets',
      invalidDraft((draft) => {
        draft.misconceptions[0].kc_ids = ['another-kc'];
      }),
      ['experiences', 0, 'diagnostic_misconception_ids', 0],
    ],
    [
      'rejects prerequisite cycles',
      invalidDraft((draft) => {
        draft.kcs.push({ ...draft.kcs[0], id: 'another-kc', prerequisite_kc_ids: ['kc-evidence'] });
        draft.kcs[0].prerequisite_kc_ids = ['another-kc'];
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
});
