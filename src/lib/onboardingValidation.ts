// What the onboarding form must reject before it submits.
//
// courseSetupProposalSchema and learnerContextSchema are the authority; this is
// a client-side mirror of the subset a learner can actually violate from the
// form. Keeping it here rather than inline in the component means the mirror
// can be tested against the schema it mirrors — tests/onboarding-validation
// asserts that anything this accepts, the server also accepts, so the two
// cannot drift into the state that produced the original bug: a 1-character
// course code passed the form, failed the schema, and surfaced to the learner
// as "Too small: expected string to have >=2 characters" repeated once per bad
// field, naming none of them.
import { isPlaceholderKcName } from './placeholderKc';

export type OnboardingSetupState = {
  university: string;
  otherUniversity: string;
  program: string;
  customTermLabel: string;
  termStart: string;
  termEnd: string;
  /** The chosen course, or null while none is selected. */
  course: { code: string; title: string } | null;
  /** Names of the concepts the learner has left included. */
  includedKcNames: string[];
};

/** Human-readable problems, empty when the form is safe to submit. */
export function onboardingSetupProblems(state: OnboardingSetupState): string[] {
  const problems: string[] = [];
  const present = (value: string) => value.trim().length > 0;

  // Blank is not a problem for any of these: the form substitutes a default
  // ("Other institution", "Current semester") and program is simply omitted.
  // Only a present-but-too-short value reaches the schema and fails it, so
  // flagging blanks here would reject input the server accepts.
  const tooShort = (value: string) => present(value) && value.trim().length < 2;

  if (state.university === 'Other') {
    if (tooShort(state.otherUniversity)) problems.push('University name needs at least 2 characters.');
    if (tooShort(state.customTermLabel)) problems.push('Semester name needs at least 2 characters.');
    if (state.termStart && state.termEnd && state.termEnd < state.termStart) {
      problems.push('Semester end must be on or after its start.');
    }
  }

  if (tooShort(state.program)) problems.push('Program needs at least 2 characters, or leave it blank.');

  if (state.course) {
    if (state.course.code.trim().length < 2) problems.push('Course code needs at least 2 characters.');
    if (state.course.title.trim().length < 2) problems.push('Course title needs at least 2 characters.');
    if (state.includedKcNames.some((name) => name.trim().length < 2)) {
      problems.push('Every concept needs a name of at least 2 characters.');
    }
    // The import would be accepted and then reported incomplete, because a
    // course of nothing but filler concepts does not count as usable.
    if (state.includedKcNames.length > 0 && state.includedKcNames.every(isPlaceholderKcName)) {
      problems.push('Name what the course actually covers — placeholder concepts like “General” are too generic to plan from.');
    }
  }

  return problems;
}
