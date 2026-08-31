// Regression test for the unguarded-date-parsing bug: submit() built its POST
// body with `new Date(when).toISOString()`. The datetime-local input has
// `required`, but testing-library's fireEvent.submit dispatches the event
// directly and does not run the browser's native constraint validation, so a
// programmatically-cleared value reaches submit() same as it would if a real
// browser's own validation were ever bypassed. `new Date('')` is an Invalid
// Date and `.toISOString()` on it threw uncaught. This drives that path
// through the real DOM and asserts the fixed behavior: a validation message,
// and no POST sent.
//
// Unlike EventTimeline's loadError (which drives a top-level {#if}/{:else if}
// that swaps the whole list for a single message — see EventTimeline.test.ts
// for that failure mode and its fix via a separate editError), submitError
// here is only ever read *inside* the `{:else}` branch that already renders
// the form; the branch itself is keyed on `confirmation`/`selectedType`, not
// on submitError. So the form is not expected to unmount — this test proves
// that stays true rather than assuming it.
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LogEventModal from '../../src/components/events/LogEventModal.svelte';
import { apiFetch } from '../../src/lib/apiClient';

vi.mock('../../src/lib/apiClient', () => ({ apiFetch: vi.fn() }));

const mockApiFetch = vi.mocked(apiFetch);

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue({ ok: true, data: [] });
});

afterEach(() => {
  cleanup();
});

describe('LogEventModal submit: unguarded date parsing', () => {
  it('shows a validation message and posts nothing when the datetime field is cleared before submit', async () => {
    render(LogEventModal, { props: { open: true } });

    await fireEvent.click(screen.getByRole('button', { name: 'Did reading' }));
    const dtInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(dtInput).toBeTruthy();

    // Type a note first — this is the in-progress edit that would be lost if
    // the validation message ever unmounted the form (EventTimeline's bug).
    const noteInput = screen.getByRole('textbox', { name: /Note/i }) as HTMLTextAreaElement;
    await fireEvent.input(noteInput, { target: { value: 'Covered chapters 4-5' } });

    await fireEvent.input(dtInput, { target: { value: '' } });
    // happy-dom doesn't run the browser's default "click a submit button"
    // form-submission algorithm, so fire the submit event directly (the
    // form's own handler does `e.preventDefault(); submit();` regardless).
    await fireEvent.submit(dtInput.closest('form') as HTMLFormElement);

    await screen.findByText('Enter a valid date and time.');
    expect(mockApiFetch).not.toHaveBeenCalledWith('/api/v1/events', expect.anything(), expect.anything());

    // The form must still be mounted with the user's note intact — the
    // message must render alongside the form, not replace it.
    const noteAfter = screen.getByRole('textbox', { name: /Note/i }) as HTMLTextAreaElement;
    expect(noteAfter.value).toBe('Covered chapters 4-5');
    expect(screen.getByRole('button', { name: /Log event/ })).toBeTruthy();
  });

  it('still submits normally when the datetime field holds a real value', async () => {
    render(LogEventModal, { props: { open: true } });

    await fireEvent.click(screen.getByRole('button', { name: 'Did reading' }));
    const dtInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await fireEvent.input(dtInput, { target: { value: '2026-08-21T09:30' } });

    mockApiFetch.mockResolvedValueOnce({ ok: true, data: {} });
    await fireEvent.submit(dtInput.closest('form') as HTMLFormElement);

    await vi.waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/events', expect.anything(), expect.anything()),
    );
    const call = mockApiFetch.mock.calls.find(([url]) => url === '/api/v1/events');
    const body = JSON.parse((call?.[1] as RequestInit).body as string);
    expect(body.ts).toBe(new Date('2026-08-21T09:30').toISOString());
  });
});
