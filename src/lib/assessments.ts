// The client-side shape of an assessment as the course/standing islands render
// it, plus the small vocabulary the add and edit forms share.
//
// Deliberately a zod-free copy of the type list in src/lib/schemas/assessments.ts:
// that module builds zod schemas at import time, so importing it from a browser
// island would ship zod to the client for the sake of five strings. The two
// lists must stay in step; the server rejects anything else.
import type { NumericFieldBinding } from './numericField';

export interface Assessment {
  id: string;
  title: string;
  type: string;
  kind: 'official' | 'practice';
  due_date: string | null;
  weight_pct: number | null;
  grade_received: number | null;
  grade_max: number | null;
  kc_ids: string[];
}

export const ASSESSMENT_TYPES = ['quiz', 'assignment', 'midterm', 'final', 'lab'] as const;

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
  kind: 'official' | 'practice';
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
