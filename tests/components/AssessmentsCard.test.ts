// Characterization tests for AssessmentsCard — they pin what the component
// does TODAY, bugs included. Several tests assert behavior that is a known
// defect (called out per-test below); those assertions are meant to be
// flipped deliberately in a later commit that fixes the bug, not "corrected"
// here. Do not use these tests as a spec for how the component *should*
// behave.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AssessmentsCard from '../../src/components/standing/AssessmentsCard.svelte';
import { apiFetch } from '../../src/lib/apiClient';
import { courseContext } from '../../src/lib/stores/courseContext';

vi.mock('../../src/lib/apiClient', () => ({ apiFetch: vi.fn() }));

const mockApiFetch = vi.mocked(apiFetch);

interface Assessment {
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

function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: 'a1',
    title: 'Quiz 1',
    type: 'quiz',
    kind: 'official',
    due_date: null,
    weight_pct: 10,
    grade_received: null,
    grade_max: null,
    kc_ids: [],
    ...overrides,
  };
}

// A promise plus its externally-callable resolve/reject, for pinning
// mid-flight (pending-request) states deterministically.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function okResult<T>(data: T) {
  return { ok: true as const, data };
}

function httpError(error: string) {
  return { ok: false as const, error, reason: 'http' as const };
}

function networkError(error: string) {
  return { ok: false as const, error, reason: 'network' as const };
}

function rowFor(title: string): HTMLElement {
  const cell = screen.getByText(title);
  const row = cell.closest('tr');
  if (!row) throw new Error(`no <tr> ancestor for "${title}"`);
  return row as HTMLElement;
}

function requestBody(callIndex: number): unknown {
  const call = mockApiFetch.mock.calls[callIndex];
  const init = call[1] as RequestInit | undefined;
  return init?.body ? JSON.parse(init.body as string) : undefined;
}

beforeEach(() => {
  mockApiFetch.mockReset();
  courseContext.set(null);
});

afterEach(() => {
  cleanup();
});

describe('rendering', () => {
  it('shows the empty message when there are no official assessments', () => {
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [] } });
    expect(screen.getByText('No official assessments yet.')).toBeTruthy();
  });

  it('renders official assessments in the graded table and practice assessments in the ungraded list', () => {
    render(AssessmentsCard, {
      props: {
        courseId: 'c1',
        assessments: [
          makeAssessment({ id: 'a1', title: 'Midterm', kind: 'official' }),
          makeAssessment({ id: 'a2', title: 'Flashcard drill', kind: 'practice' }),
        ],
      },
    });
    expect(within(rowFor('Midterm')).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.getByText('Flashcard drill')).toBeTruthy();
    expect(screen.queryByText('No official assessments yet.')).toBeNull();
  });

  it('falls back to "No due date" when due_date is null', () => {
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [makeAssessment({ due_date: null })] } });
    expect(screen.getByText('No due date')).toBeTruthy();
  });
});

describe('grade saving — ordinary behavior', () => {
  // NOTE ON A BRIEF DISCREPANCY: the brief expected clearing both fields to
  // send `null` for each (contrasted with an explicit "0" below, which sends
  // 0). That is NOT what happens — see the "NEW FINDING" describe block
  // further down for why, and for the corrected characterization. This test
  // pins the real, verified behavior instead: clearing sends 0.
  it('sends 0 (not null) for both fields when both grade inputs are cleared', async () => {
    render(AssessmentsCard, {
      props: { courseId: 'c1', assessments: [makeAssessment({ grade_received: 80, grade_max: 100 })] },
    });
    const row = rowFor('Quiz 1');
    const [received, max] = within(row).getAllByRole('spinbutton');
    await fireEvent.input(received, { target: { value: '' } });
    await fireEvent.input(max, { target: { value: '' } });
    mockApiFetch.mockResolvedValueOnce(okResult({ grade_received: 0, grade_max: 0, mastery_deltas: [] }));
    await fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    expect(requestBody(0)).toEqual({ grade_received: 0, grade_max: 0 });
  });

  it('sends 0 (not null) when the grade received field is explicitly "0"', async () => {
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [makeAssessment({ grade_max: 100 })] } });
    const row = rowFor('Quiz 1');
    const [received] = within(row).getAllByRole('spinbutton');
    await fireEvent.input(received, { target: { value: '0' } });
    mockApiFetch.mockResolvedValueOnce(okResult({ grade_received: 0, grade_max: 100, mastery_deltas: [] }));
    await fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    const body = requestBody(0) as Record<string, unknown>;
    expect(body.grade_received).toBe(0);
    expect(body.grade_received).not.toBeNull();
  });

  it('accepts a grade received above grade max with no client-side warning', async () => {
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [makeAssessment()] } });
    const row = rowFor('Quiz 1');
    const [received, max] = within(row).getAllByRole('spinbutton');
    await fireEvent.input(received, { target: { value: '150' } });
    await fireEvent.input(max, { target: { value: '100' } });
    mockApiFetch.mockResolvedValueOnce(okResult({ grade_received: 150, grade_max: 100, mastery_deltas: [] }));
    await fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    expect(requestBody(0)).toEqual({ grade_received: 150, grade_max: 100 });
    expect(screen.queryByText(/warn/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the mastery-linked message only when mastery_deltas is non-empty', async () => {
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [makeAssessment()] } });
    const row = rowFor('Quiz 1');
    const [received, max] = within(row).getAllByRole('spinbutton');
    await fireEvent.input(received, { target: { value: '9' } });
    await fireEvent.input(max, { target: { value: '10' } });
    mockApiFetch.mockResolvedValueOnce(okResult({ grade_received: 9, grade_max: 10, mastery_deltas: [{ kc_id: 'k1' }] }));
    await fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved — logged an event for linked concepts.');
  });

  it('fires onGraded on every successful grade save, including a no-op re-save of the same value', async () => {
    const onGraded = vi.fn();
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [makeAssessment({ grade_received: 5, grade_max: 10 })], onGraded } });
    const row = rowFor('Quiz 1');
    const saveBtn = within(row).getByRole('button', { name: 'Save' });
    mockApiFetch.mockResolvedValueOnce(okResult({ grade_received: 5, grade_max: 10, mastery_deltas: [] }));
    await fireEvent.click(saveBtn);
    await screen.findByText('Saved.');
    expect(onGraded).toHaveBeenCalledTimes(1);

    mockApiFetch.mockResolvedValueOnce(okResult({ grade_received: 5, grade_max: 10, mastery_deltas: [] }));
    await fireEvent.click(saveBtn);
    await vi.waitFor(() => expect(onGraded).toHaveBeenCalledTimes(2));
  });
});

describe('KNOWN BUG: non-finite grade input silently clears an existing grade (claim #1)', () => {
  // The teammate's original repro ("type the letters 'abc'") does not
  // reproduce here: happy-dom faithfully implements native <input
  // type="number"> value sanitization, so a non-numeric keystroke sequence
  // never reaches the bound variable — the DOM element's own .value resets
  // to "" first, and that empty string is then handled by the component's
  // *intentional* `draft.received === ''` guard (sends null on purpose,
  // covered above). That is a different code path than the one described,
  // even though the two happen to produce the same wire body.
  //
  // The real Number()->NaN/Infinity->JSON.stringify->null bug IS reachable
  // through the actual <input type="number"> element, via a syntactically
  // valid numeral that overflows: "1e400" passes the browser's number-input
  // syntax check (so the DOM keeps it verbatim) but Number('1e400') is
  // Infinity, and JSON.stringify(Infinity) is the literal `null`. Verified
  // empirically against this test's own DOM (happy-dom) before writing this
  // test. This is the accidental path claim #1 was pointing at.
  it('an overflowing numeral ("1e400") sends grade_received: null with no error shown, silently clearing a real grade', async () => {
    render(AssessmentsCard, {
      props: { courseId: 'c1', assessments: [makeAssessment({ grade_received: 92, grade_max: 100 })] },
    });
    const row = rowFor('Quiz 1');
    const [received] = within(row).getAllByRole('spinbutton');
    await fireEvent.input(received, { target: { value: '1e400' } });
    expect((received as HTMLInputElement).valueAsNumber).toBe(Infinity);
    mockApiFetch.mockResolvedValueOnce(okResult({ grade_received: null, grade_max: 100, mastery_deltas: [] }));
    await fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    const body = requestBody(0) as Record<string, unknown>;
    expect(body.grade_received).toBeNull();
    expect(screen.queryByText(/error/i)).toBeNull();
  });
});

describe('NEW FINDING (not one of the seven listed claims): every `=== \'\'` empty-guard on a number input is dead code', () => {
  // Discovered while writing these tests, verified against this project's
  // actual Svelte/happy-dom runtime (not speculation): for an
  // `<input type="number" bind:value>`, once the field has been edited via
  // a real input event, an emptied field does NOT bind back to the string
  // `''`. Svelte's numeric-binding transform sets the bound variable to the
  // literal JS `null` instead. `Number(null)` is `0`, so every place in this
  // component that guards on `draft.x === ''` to mean "field is empty, send
  // null" silently falls through to `Number(null) = 0` instead. This is a
  // more far-reaching bug than claim #1 (which only covers overflowing
  // numerals) and it directly contradicts the brief's "ordinary edge case"
  // claim that clearing a grade field sends null — verified above, it sends
  // 0. The same mechanism also hits weight_pct in both the add and edit
  // forms, pinned below.
  //
  // Caveat that matters for correct characterization: this only fires once
  // an `input`/`change` event has actually touched the field. A field left
  // completely untouched keeps whatever plain-JS string it was initialized
  // to (e.g. draftWeight's `$state('')`), so `=== ''` still works for a
  // pristine field — the guard only dies after an edit-then-clear cycle.

  it('leaving Weight % blank after typing into it sends weight_pct: 0 in an official add, instead of omitting the key', async () => {
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [] } });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await fireEvent.input(screen.getByPlaceholderText('Title'), { target: { value: 'Weighted quiz' } });
    const weightInput = screen.getByPlaceholderText('Weight %');
    await fireEvent.input(weightInput, { target: { value: '20' } });
    await fireEvent.input(weightInput, { target: { value: '' } });
    mockApiFetch.mockResolvedValueOnce(okResult(makeAssessment({ id: 'new1', title: 'Weighted quiz' })));
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await screen.findByText('Weighted quiz');
    const body = requestBody(0) as Record<string, unknown>;
    expect(body.weight_pct).toBe(0);
  });

  it('clearing a previously-set Weight % in the edit form sends weight_pct: 0, not null', async () => {
    render(AssessmentsCard, {
      props: { courseId: 'c1', assessments: [makeAssessment({ id: 'a1', title: 'Weighted row', weight_pct: 10 })] },
    });
    await fireEvent.click(within(rowFor('Weighted row')).getByRole('button', { name: 'Edit' }));
    const editForm = rowFor('Weighted row').nextElementSibling as HTMLElement;
    const weightInput = within(editForm).getByPlaceholderText('Weight %');
    await fireEvent.input(weightInput, { target: { value: '' } });
    mockApiFetch.mockResolvedValueOnce(okResult({ title: 'Weighted row', type: 'quiz', due_date: null, weight_pct: 0, kc_ids: [] }));
    await fireEvent.click(within(editForm).getByRole('button', { name: /sav/i }));
    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    const body = requestBody(0) as Record<string, unknown>;
    expect(body.weight_pct).toBe(0);
    expect(body.weight_pct).not.toBeNull();
  });

  it('by contrast, a pristine (never-touched) Weight % field still omits the key on add — the guard only dies after an edit-then-clear cycle', async () => {
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [] } });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await fireEvent.input(screen.getByPlaceholderText('Title'), { target: { value: 'Untouched weight quiz' } });
    mockApiFetch.mockResolvedValueOnce(okResult(makeAssessment({ id: 'new2', title: 'Untouched weight quiz' })));
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await screen.findByText('Untouched weight quiz');
    const body = requestBody(0) as Record<string, unknown>;
    expect('weight_pct' in body).toBe(false);
  });
});

describe('KNOWN BUG: gradeSavingId is a single id, not a set (claim #2)', () => {
  it('starting a save on row B re-enables row A\'s Save button while A is still in flight', async () => {
    render(AssessmentsCard, {
      props: {
        courseId: 'c1',
        assessments: [makeAssessment({ id: 'a1', title: 'Quiz A' }), makeAssessment({ id: 'a2', title: 'Quiz B' })],
      },
    });
    const rowA = rowFor('Quiz A');
    const rowB = rowFor('Quiz B');
    const saveA = within(rowA).getByRole('button', { name: /sav/i });
    const saveB = within(rowB).getByRole('button', { name: /sav/i });

    const defA = deferred<ReturnType<typeof okResult<{ grade_received: number | null; grade_max: number | null }>>>();
    mockApiFetch.mockReturnValueOnce(defA.promise);
    await fireEvent.click(saveA);
    await tick();
    expect((saveA as HTMLButtonElement).disabled).toBe(true);
    expect(saveA.textContent).toContain('Saving…');

    const defB = deferred<ReturnType<typeof okResult<{ grade_received: number | null; grade_max: number | null }>>>();
    mockApiFetch.mockReturnValueOnce(defB.promise);
    await fireEvent.click(saveB);
    await tick();

    // BUG: A's button is re-enabled even though A's PATCH never resolved.
    expect((saveA as HTMLButtonElement).disabled).toBe(false);
    expect(saveA.textContent).toContain('Save');
    expect((saveB as HTMLButtonElement).disabled).toBe(true);

    // And because it's re-enabled, clicking it again fires a second
    // concurrent PATCH for the same row.
    const defA2 = deferred<ReturnType<typeof okResult<{ grade_received: number | null; grade_max: number | null }>>>();
    mockApiFetch.mockReturnValueOnce(defA2.promise);
    await fireEvent.click(saveA);
    expect(mockApiFetch).toHaveBeenCalledTimes(3);

    defA.resolve(okResult({ grade_received: null, grade_max: null, mastery_deltas: [] }));
    defB.resolve(okResult({ grade_received: null, grade_max: null, mastery_deltas: [] }));
    defA2.resolve(okResult({ grade_received: null, grade_max: null, mastery_deltas: [] }));
    await vi.waitFor(() => expect((saveA as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('KNOWN BUG: add-form errors are swallowed when the form is hidden (claim #3)', () => {
  it('opening Edit while an Add is in flight hides the form, and a subsequent add failure is never shown', async () => {
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [makeAssessment({ id: 'a1', title: 'Existing row' })] } });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await fireEvent.input(screen.getByPlaceholderText('Title'), { target: { value: 'New Quiz' } });

    const defAdd = deferred<ReturnType<typeof httpError>>();
    mockApiFetch.mockReturnValueOnce(defAdd.promise);
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await tick();

    // openEdit() force-closes the add form mid-flight (addOpen = false),
    // with no warning that a request is still outstanding.
    await fireEvent.click(within(rowFor('Existing row')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: '+ Add assessment' })).toBeTruthy();

    defAdd.resolve(httpError('Could not add assessment.'));
    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    await tick();
    await tick();

    // BUG: the error is set internally but nothing on screen shows it,
    // because addError only renders inside the (now-closed) add form.
    expect(screen.queryByText('Could not add assessment.')).toBeNull();
    // And the failed add never got appended to the list either.
    expect(screen.queryByText('New Quiz')).toBeNull();
  });
});

describe('KNOWN BUG: a resolving save closes a different row\'s open edit form (claim #4)', () => {
  it('finishing row A\'s edit-save yanks shut row B\'s unrelated, unsaved edit form', async () => {
    render(AssessmentsCard, {
      props: {
        courseId: 'c1',
        assessments: [makeAssessment({ id: 'a1', title: 'Row A' }), makeAssessment({ id: 'a2', title: 'Row B' })],
      },
    });
    await fireEvent.click(within(rowFor('Row A')).getByRole('button', { name: 'Edit' }));
    const editFormA = rowFor('Row A').nextElementSibling as HTMLElement;
    const defEditA = deferred<ReturnType<typeof okResult<{ title: string; type: string; due_date: string | null; weight_pct: number | null; kc_ids: string[] }>>>();
    mockApiFetch.mockReturnValueOnce(defEditA.promise);
    await fireEvent.click(within(editFormA).getByRole('button', { name: /sav/i }));
    await tick();

    // Switch Edit to row B while A's save is still in flight.
    await fireEvent.click(within(rowFor('Row B')).getByRole('button', { name: 'Edit' }));
    const editFormB = rowFor('Row B').nextElementSibling as HTMLElement;
    const titleB = within(editFormB).getByPlaceholderText('Title');

    // BUG: B's brand-new form inherits the shared editSaving flag it never
    // earned — its Save button is already disabled/"Saving…".
    const saveB = within(editFormB).getByRole('button', { name: /sav/i }) as HTMLButtonElement;
    expect(saveB.disabled).toBe(true);
    expect(saveB.textContent).toContain('Saving…');

    await fireEvent.input(titleB, { target: { value: 'Unsaved B edit' } });

    defEditA.resolve(okResult({ title: 'Row A', type: 'quiz', due_date: null, weight_pct: 10, kc_ids: [] }));
    await vi.waitFor(() => expect(screen.queryByDisplayValue('Unsaved B edit')).toBeNull());

    // BUG: B's draft is gone and its edit form is closed, with no save
    // ever sent for B — B's row still shows its original title.
    expect(screen.getByText('Row B')).toBeTruthy();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('KNOWN BUG: the assessments prop is forked once, not kept in sync (claim #5)', () => {
  it('a re-passed assessments prop with changed data never reaches the rendered list', async () => {
    const { rerender } = render(AssessmentsCard, {
      props: { courseId: 'c1', assessments: [makeAssessment({ id: 'a1', title: 'Original title' })] },
    });
    expect(screen.getByText('Original title')).toBeTruthy();

    await rerender({ courseId: 'c1', assessments: [makeAssessment({ id: 'a1', title: 'Updated title' })] });
    await tick();

    // BUG: the component keeps showing its own forked copy of the array.
    expect(screen.getByText('Original title')).toBeTruthy();
    expect(screen.queryByText('Updated title')).toBeNull();
  });
});

describe('KNOWN BUG: a failed KC fetch never retries for the component\'s lifetime (claim #6)', () => {
  it('closing and reopening the add form after a failed KC fetch does not fetch again, and the stale error persists', async () => {
    courseContext.set({ id: 'c1', slug: 'course-slug', code: 'C1', title: 'Course 1' });
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [] } });

    mockApiFetch.mockResolvedValueOnce(networkError('Network error.'));
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await screen.findByText('Network error.');
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await tick();

    // BUG: courseKcs is [] (not null) after the failure, so the "not yet
    // fetched" guard is satisfied and no retry is attempted, ever again.
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Network error.')).toBeTruthy();
  });
});

describe('KNOWN BUG: a failed edit save leaves a stale, permanently-404ing form open (claim #7)', () => {
  it('an edit PATCH failure keeps the row editable with the error shown and the row unchanged, and a retry fails the same way', async () => {
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [makeAssessment({ id: 'a1', title: 'Doomed row' })] } });
    await fireEvent.click(within(rowFor('Doomed row')).getByRole('button', { name: 'Edit' }));
    let editForm = rowFor('Doomed row').nextElementSibling as HTMLElement;
    await fireEvent.input(within(editForm).getByPlaceholderText('Title'), { target: { value: 'Renamed' } });

    mockApiFetch.mockResolvedValueOnce(httpError('Not found'));
    await fireEvent.click(within(editForm).getByRole('button', { name: /sav/i }));
    await screen.findByText('Not found');

    // Row itself never updated (the PATCH failed) and the form is still open.
    expect(screen.getByText('Doomed row')).toBeTruthy();
    editForm = rowFor('Doomed row').nextElementSibling as HTMLElement;
    expect(within(editForm).getByDisplayValue('Renamed')).toBeTruthy();

    // Retrying fails the exact same way — there is no path out of this
    // state other than abandoning the edit.
    mockApiFetch.mockResolvedValueOnce(httpError('Not found'));
    await fireEvent.click(within(editForm).getByRole('button', { name: /sav/i }));
    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Not found')).toBeTruthy();
    expect(rowFor('Doomed row').nextElementSibling).not.toBeNull();
  });
});

describe('add / edit request bodies', () => {
  it('omits due_date from the POST body when the add-form date is left empty', async () => {
    render(AssessmentsCard, { props: { courseId: 'course-9', assessments: [] } });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await fireEvent.input(screen.getByPlaceholderText('Title'), { target: { value: 'No date quiz' } });
    mockApiFetch.mockResolvedValueOnce(okResult(makeAssessment({ id: 'new1', title: 'No date quiz' })));
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await screen.findByText('No date quiz');

    expect(mockApiFetch.mock.calls[0][0]).toBe('/api/v1/courses/course-9/assessments');
    const body = requestBody(0) as Record<string, unknown>;
    expect('due_date' in body).toBe(false);
  });

  it('sends due_date: null explicitly when an edit clears a previously-set date', async () => {
    render(AssessmentsCard, {
      props: { courseId: 'c1', assessments: [makeAssessment({ id: 'a1', title: 'Dated row', due_date: '2027-01-15T12:00:00.000Z' })] },
    });
    await fireEvent.click(within(rowFor('Dated row')).getByRole('button', { name: 'Edit' }));
    const editForm = rowFor('Dated row').nextElementSibling as HTMLElement;
    const dateInput = within(editForm).getByDisplayValue('2027-01-15') as HTMLInputElement;
    await fireEvent.input(dateInput, { target: { value: '' } });

    mockApiFetch.mockResolvedValueOnce(okResult({ title: 'Dated row', type: 'quiz', due_date: null, weight_pct: 10, kc_ids: [] }));
    await fireEvent.click(within(editForm).getByRole('button', { name: /sav/i }));
    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));

    const body = requestBody(0) as Record<string, unknown>;
    expect(body.due_date).toBeNull();
  });
});

describe('callback contract', () => {
  it('does not fire onPracticeChange when adding an official assessment', async () => {
    const onPracticeChange = vi.fn();
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [], onPracticeChange } });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await fireEvent.input(screen.getByPlaceholderText('Title'), { target: { value: 'Official quiz' } });
    mockApiFetch.mockResolvedValueOnce(okResult(makeAssessment({ id: 'new1', title: 'Official quiz', kind: 'official' })));
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await screen.findByText('Official quiz');
    expect(onPracticeChange).not.toHaveBeenCalled();
  });

  it('fires onPracticeChange when adding a practice assessment', async () => {
    const onPracticeChange = vi.fn();
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [], onPracticeChange } });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await fireEvent.input(screen.getByPlaceholderText('Title'), { target: { value: 'Practice drill' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    mockApiFetch.mockResolvedValueOnce(okResult(makeAssessment({ id: 'new1', title: 'Practice drill', kind: 'practice' })));
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await screen.findByText('Practice drill');
    expect(onPracticeChange).toHaveBeenCalledTimes(1);
  });

  it('fires onPracticeChange when marking a practice assessment done', async () => {
    const onPracticeChange = vi.fn();
    render(AssessmentsCard, {
      props: { courseId: 'c1', assessments: [makeAssessment({ id: 'p1', title: 'Drill', kind: 'practice', grade_received: null })], onPracticeChange },
    });
    mockApiFetch.mockResolvedValueOnce(okResult({}));
    await fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await vi.waitFor(() => expect(onPracticeChange).toHaveBeenCalledTimes(1));
  });

  it('fires neither onGraded nor onPracticeChange when an edit (weight/kc) save succeeds', async () => {
    const onGraded = vi.fn();
    const onPracticeChange = vi.fn();
    render(AssessmentsCard, {
      props: { courseId: 'c1', assessments: [makeAssessment({ id: 'a1', title: 'Weighted row' })], onGraded, onPracticeChange },
    });
    await fireEvent.click(within(rowFor('Weighted row')).getByRole('button', { name: 'Edit' }));
    const editForm = rowFor('Weighted row').nextElementSibling as HTMLElement;
    const weightInput = within(editForm).getByPlaceholderText('Weight %');
    await fireEvent.input(weightInput, { target: { value: '25' } });
    mockApiFetch.mockResolvedValueOnce(okResult({ title: 'Weighted row', type: 'quiz', due_date: null, weight_pct: 25, kc_ids: [] }));
    await fireEvent.click(within(editForm).getByRole('button', { name: /sav/i }));
    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    expect(onGraded).not.toHaveBeenCalled();
    expect(onPracticeChange).not.toHaveBeenCalled();
  });
});

describe('add-form vs edit-form draft persistence', () => {
  it('Cancel on the add form does not reset the draft — reopening shows the same fields', async () => {
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [] } });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await fireEvent.input(screen.getByPlaceholderText('Title'), { target: { value: 'Half-typed' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    expect((screen.getByPlaceholderText('Title') as HTMLInputElement).value).toBe('Half-typed');
    expect(screen.getByRole('button', { name: 'Practice' }).classList.contains('active')).toBe(true);
  });

  it('reopening Edit on the same row after Close resets the draft from the (unchanged) server values', async () => {
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [makeAssessment({ id: 'a1', title: 'Server title' })] } });
    await fireEvent.click(within(rowFor('Server title')).getByRole('button', { name: 'Edit' }));
    let editForm = rowFor('Server title').nextElementSibling as HTMLElement;
    await fireEvent.input(within(editForm).getByPlaceholderText('Title'), { target: { value: 'temp' } });

    await fireEvent.click(within(rowFor('Server title')).getByRole('button', { name: 'Close' }));
    await fireEvent.click(within(rowFor('Server title')).getByRole('button', { name: 'Edit' }));
    editForm = rowFor('Server title').nextElementSibling as HTMLElement;
    expect((within(editForm).getByPlaceholderText('Title') as HTMLInputElement).value).toBe('Server title');
  });
});

describe('KC picker messages', () => {
  it('shows the fetch-error message (not the empty-course message) when the KC fetch fails', async () => {
    courseContext.set({ id: 'c1', slug: 'course-slug', code: 'C1', title: 'Course 1' });
    mockApiFetch.mockResolvedValueOnce(networkError('Network error.'));
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [] } });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await screen.findByText('Network error.');
    expect(screen.queryByText('No concepts defined for this course yet.')).toBeNull();
  });

  it('shows the empty-course message (not an error) when the fetch succeeds with no KCs', async () => {
    courseContext.set({ id: 'c1', slug: 'course-slug', code: 'C1', title: 'Course 1' });
    mockApiFetch.mockResolvedValueOnce(okResult({ branches: [{ kcs: [] }] }));
    render(AssessmentsCard, { props: { courseId: 'c1', assessments: [] } });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await screen.findByText('No concepts defined for this course yet.');
  });
});

describe('list ordering', () => {
  it('appends a newly-added assessment to the end regardless of its due date', async () => {
    render(AssessmentsCard, {
      props: {
        courseId: 'c1',
        assessments: [
          makeAssessment({ id: 'a1', title: 'Later quiz', due_date: '2027-03-01T12:00:00.000Z' }),
          makeAssessment({ id: 'a2', title: 'Even later quiz', due_date: '2027-06-01T12:00:00.000Z' }),
        ],
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: '+ Add assessment' }));
    await fireEvent.input(screen.getByPlaceholderText('Title'), { target: { value: 'Earliest quiz' } });
    mockApiFetch.mockResolvedValueOnce(
      okResult(makeAssessment({ id: 'a3', title: 'Earliest quiz', due_date: '2026-01-01T12:00:00.000Z' })),
    );
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await screen.findByText('Earliest quiz');

    const titles = screen.getAllByRole('row').map((r) => r.textContent).filter((t): t is string => !!t && /quiz/.test(t));
    const order = ['Later quiz', 'Even later quiz', 'Earliest quiz'].map((t) => titles.findIndex((row) => row.includes(t)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[2]).toBeGreaterThan(order[0]);
    expect(order[2]).toBeGreaterThan(order[1]);
  });

  it('editing a due date does not re-sort the table', async () => {
    render(AssessmentsCard, {
      props: {
        courseId: 'c1',
        assessments: [
          makeAssessment({ id: 'a1', title: 'First row', due_date: '2027-01-01T12:00:00.000Z' }),
          makeAssessment({ id: 'a2', title: 'Second row', due_date: '2027-06-01T12:00:00.000Z' }),
        ],
      },
    });
    await fireEvent.click(within(rowFor('First row')).getByRole('button', { name: 'Edit' }));
    const editForm = rowFor('First row').nextElementSibling as HTMLElement;
    const dateInput = within(editForm).getByDisplayValue('2027-01-01');
    await fireEvent.input(dateInput, { target: { value: '2028-01-01' } });
    mockApiFetch.mockResolvedValueOnce(
      okResult({ title: 'First row', type: 'quiz', due_date: '2028-01-01T12:00:00.000Z', weight_pct: 10, kc_ids: [] }),
    );
    await fireEvent.click(within(editForm).getByRole('button', { name: /sav/i }));
    await vi.waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));

    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    const firstIdx = rows.findIndex((t) => t.includes('First row'));
    const secondIdx = rows.findIndex((t) => t.includes('Second row'));
    expect(firstIdx).toBeLessThan(secondIdx);
  });
});
