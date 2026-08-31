import { describe, expect, it } from 'vitest';
import { courseSetupProposalSchema, learnerContextSchema } from '../src/lib/schemas/onboarding';
import { onboardingSetupProblems, type OnboardingSetupState } from '../src/lib/onboardingValidation';

const CLEAN: OnboardingSetupState = {
  university: 'Other',
  otherUniversity: 'Concordia University',
  program: 'Chemical Engineering',
  customTermLabel: 'Fall 2026',
  termStart: '2026-08-31',
  termEnd: '2026-12-22',
  course: { code: 'CHEE 314', title: 'Fluid Mechanics' },
  includedKcNames: ['Bernoulli equation', 'Viscosity'],
};

// Mirrors finishFresh: blanks take a default, program is omitted when blank.
function contextFrom(state: OnboardingSetupState) {
  return {
    institution_name: state.university === 'Other' ? (state.otherUniversity.trim() || 'Other institution') : 'McGill University',
    ...(state.program.trim() ? { program_name: state.program.trim() } : {}),
    term_label: state.university === 'Other' ? (state.customTermLabel.trim() || 'Current semester') : 'Fall 2026',
    starts_on: state.termStart,
    ends_on: state.termEnd,
    timezone: 'America/Toronto',
  };
}

function proposalFrom(state: OnboardingSetupState) {
  return {
    schema_version: 1 as const,
    course: { code: state.course!.code, title: state.course!.title },
    branches: [{
      client_id: crypto.randomUUID(),
      included: true,
      name: 'Course map',
      sort_order: 0,
      kcs: state.includedKcNames.map((name, index) => ({
        client_id: crypto.randomUUID(),
        included: true,
        name,
        kc_type: 'concept' as const,
        sort_order: index,
        prereq_refs: [],
        source_refs: ['Manual entry'],
      })),
    }],
    assessments: [],
    source: { kind: 'manual' as const },
  };
}

/** True when the server would accept this state's payload. */
function serverAccepts(state: OnboardingSetupState): boolean {
  return learnerContextSchema.safeParse(contextFrom(state)).success
    && courseSetupProposalSchema.safeParse(proposalFrom(state)).success;
}

const CASES: Array<[label: string, state: OnboardingSetupState]> = [
  ['clean', CLEAN],
  ['1-char course code', { ...CLEAN, course: { code: 'A', title: 'Fluid Mechanics' } }],
  ['1-char course title', { ...CLEAN, course: { code: 'CHEE 314', title: 'F' } }],
  ['1-char university name', { ...CLEAN, otherUniversity: 'X' }],
  ['1-char program', { ...CLEAN, program: 'Y' }],
  ['1-char semester name', { ...CLEAN, customTermLabel: 'Z' }],
  ['1-char concept name', { ...CLEAN, includedKcNames: ['Viscosity', 'Q'] }],
  ['blank university name (form substitutes a default)', { ...CLEAN, otherUniversity: '   ' }],
  ['blank program (omitted from the request)', { ...CLEAN, program: '' }],
  ['blank semester name (form substitutes a default)', { ...CLEAN, customTermLabel: '' }],
  ['McGill, so the custom fields are unused', { ...CLEAN, university: 'McGill University', otherUniversity: 'X', customTermLabel: 'Z' }],
];

// The bug this guards: the form accepted a 1-character course code, the schema
// rejected it, and the learner read "Too small: expected string to have >=2
// characters" once per bad field with no field named. The two must agree.
describe('client validation mirrors the server schema', () => {
  it.each(CASES)('%s', (_label, state) => {
    expect(onboardingSetupProblems(state).length === 0).toBe(serverAccepts(state));
  });

  it('never blocks a state the server would accept', () => {
    for (const [label, state] of CASES) {
      if (serverAccepts(state)) {
        expect(onboardingSetupProblems(state), `${label} should not be blocked`).toEqual([]);
      }
    }
  });
});

describe('problems name the field that is wrong', () => {
  it('reports each bad field separately rather than repeating one message', () => {
    const problems = onboardingSetupProblems({
      ...CLEAN, otherUniversity: 'X', program: 'Y', course: { code: 'A', title: 'B' },
    });
    expect(problems).toHaveLength(4);
    expect(new Set(problems).size).toBe(4);
    expect(problems.join(' ')).not.toMatch(/expected string to have/);
  });

  it('flags a course whose concepts are all filler, which imports as incomplete', () => {
    expect(onboardingSetupProblems({ ...CLEAN, includedKcNames: ['General'] }))
      .toEqual([expect.stringContaining('too generic')]);
    expect(onboardingSetupProblems({ ...CLEAN, includedKcNames: ['General', 'Viscosity'] })).toEqual([]);
  });

  it('flags a semester that ends before it starts', () => {
    expect(onboardingSetupProblems({ ...CLEAN, termStart: '2026-12-22', termEnd: '2026-08-31' }))
      .toEqual(['Semester end must be on or after its start.']);
  });
});
