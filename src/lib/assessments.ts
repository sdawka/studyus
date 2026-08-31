// The client-side shape of an assessment as the course/standing islands render
// it, plus the small vocabulary the add and edit forms share.
//
// This module is the single definition of the assessment type and kind lists,
// and it is a dependency-free leaf on purpose (its only import is erased at
// build time): src/lib/schemas/assessments.ts imports the lists FROM here to
// build its zod schemas, rather than the other way round. Depending the other
// way would pull zod into every browser island that renders an assessment, and
// duplicating the lists would leave two copies with nothing enforcing that they
// agree. Same shape as src/lib/placeholderKc.ts, for the same reason.
import type { NumericFieldBinding } from './numericField';

export const ASSESSMENT_TYPES = ['quiz', 'assignment', 'midterm', 'final', 'lab'] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

// v1.3.1: 'official' (default) counts toward the weighted grade; 'practice'
// never does, even when graded — see services/grades.ts.
export const ASSESSMENT_KINDS = ['official', 'practice'] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export interface Assessment {
  id: string;
  title: string;
  type: string;
  kind: AssessmentKind;
  due_date: string | null;
  weight_pct: number | null;
  grade_received: number | null;
  grade_max: number | null;
  kc_ids: string[];
}

// What the add/edit forms hold while the user is typing: `due` is the
// yyyy-mm-dd string an <input type="date"> binds ('' when unset), and `weight`
// is a numeric-input binding (see numericField.ts) rather than a string, so an
// emptied field reads as empty instead of zero.
export interface AssessmentFormDraft {
  title: string;
  type: string;
  due: string;
  weight: NumericFieldBinding;
  kcIds: Set<string>;
}

// What the two grade cells on an official row hold while they are being typed
// into — the same numeric-input binding rules as the weight field above.
export interface GradeEntry {
  received: NumericFieldBinding;
  max: NumericFieldBinding;
}

export interface AddAssessmentDraft extends AssessmentFormDraft {
  kind: AssessmentKind;
}

export function emptyAddDraft(): AddAssessmentDraft {
  return { title: '', type: 'quiz', kind: 'official', weight: '', due: '', kcIds: new Set() };
}

// There is exactly one open edit form across the card, whether the row lives in
// the official table or the practice list, so both render it from the same
// session object. The card owns the session (which row, whether its save is in
// flight, what went wrong); the form owns the fields the user is editing.
export interface EditSession {
  readonly openId: string | null;
  /** True only for the row whose form is on screen AND saving. */
  readonly busy: boolean;
  readonly error: string | null;
  toggle: (a: Assessment) => void;
  submit: (a: Assessment, draft: AssessmentFormDraft) => void;
  cancel: () => void;
}
