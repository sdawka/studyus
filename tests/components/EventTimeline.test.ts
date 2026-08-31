// Regression test for the unguarded-date-parsing bug: saveEdit built its PATCH
// body with `new Date(editTs).toISOString()` inside a bare
// `try { ... } finally { busyId = null }` with no `catch`. Clearing the
// datetime-local field before saving made `editTs` '', `new Date('')` is an
// Invalid Date, and `.toISOString()` on that throws a RangeError — the
// handler died silently: the busy flag reset (the `finally` still ran) but
// no request went out and no error appeared. This test drives that exact
// path through the real DOM and asserts the fixed behavior: a clear
// validation message, and no PATCH sent.
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventTimeline from '../../src/components/events/EventTimeline.svelte';
import { apiFetch } from '../../src/lib/apiClient';

vi.mock('../../src/lib/apiClient', () => ({ apiFetch: vi.fn() }));

const mockApiFetch = vi.mocked(apiFetch);

const EVENT = {
  id: 'e1',
  ts: '2026-08-20T10:00:00.000Z',
  type: 'reading_done',
  is_instructional: true,
  is_assessment: false,
  kc_id: null,
  course_id: null,
  payload: {},
  source: 'manual' as const,
};

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue({ ok: true, data: [EVENT] });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EventTimeline saveEdit: unguarded date parsing', () => {
  it('shows a validation message INSIDE the still-mounted edit form, without losing the user\'s other in-progress edits', async () => {
    render(EventTimeline, { props: {} });
    await screen.findByText('Did reading');

    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dtInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(dtInput).toBeTruthy();

    // Type into the note field first — this is the in-progress edit that a
    // top-level loadError swap would silently destroy (the whole event list,
    // edit form included, gets replaced by a single <p class="error"> line).
    const noteInput = screen.getByPlaceholderText('Note') as HTMLInputElement;
    await fireEvent.input(noteInput, { target: { value: 'Covered chapters 4-5' } });

    // Clearing the datetime field is exactly what produced the crash:
    // new Date('') is an Invalid Date and .toISOString() on it threw
    // uncaught.
    await fireEvent.input(dtInput, { target: { value: '' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Enter a valid date and time before saving.');
    expect(fetch).not.toHaveBeenCalled();

    // The edit form must still be mounted, with the note the user already
    // typed still there — a regression here would mean the validation
    // message replaced the whole timeline (including this form) rather than
    // rendering inside it.
    expect(screen.getByPlaceholderText('Note')).toBeTruthy();
    expect((screen.getByPlaceholderText('Note') as HTMLInputElement).value).toBe('Covered chapters 4-5');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    // The general "whole list replaced by one message" failure mode would
    // also make the row's own content (and "No events logged yet.") vanish
    // from view along with the form.
    expect(screen.queryByText('No events logged yet.')).toBeNull();
  });

  it('still saves normally when the datetime field holds a real value', async () => {
    render(EventTimeline, { props: {} });
    await screen.findByText('Did reading');

    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dtInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await fireEvent.input(dtInput, { target: { value: '2026-08-21T09:30' } });

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => EVENT,
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.ts).toBe(new Date('2026-08-21T09:30').toISOString());
  });
});
