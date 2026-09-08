import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NoteEditor from '../../src/components/notes/NoteEditor.svelte';
import { apiFetch } from '../../src/lib/apiClient';

vi.mock('../../src/lib/apiClient', () => ({ apiFetch: vi.fn() }));

const mockApiFetch = vi.mocked(apiFetch);
const note = {
  id: 'note-1',
  title: 'Existing note',
  content: 'First draft',
  updated_at: '2026-09-07T12:00:00.000Z',
  links: [],
};

const coursesWithKcs = [{
  id: 'course-1',
  code: 'HIST101',
  title: 'History',
  kcs: [{ id: 'kc-1', name: 'Spaced repetition' }],
}];

describe('NoteEditor recovery', () => {
  beforeEach(() => mockApiFetch.mockReset());

  it('serializes a newer draft after an earlier save without reporting it saved early', async () => {
    let resolveFirstSave!: (result: { ok: true; data: unknown }) => void;
    let resolveLatestSave!: (result: { ok: true; data: unknown }) => void;
    mockApiFetch
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstSave = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveLatestSave = resolve; }));

    render(NoteEditor, { props: { note, noteId: note.id, coursesWithKcs } });
    const title = screen.getByPlaceholderText('Note title') as HTMLInputElement;
    const content = screen.getByPlaceholderText('Write your note here... Markdown supported.') as HTMLTextAreaElement;

    await fireEvent.input(title, { target: { value: 'First title' } });
    await fireEvent.input(content, { target: { value: 'First content' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add links' }));
    await fireEvent.click(screen.getByRole('button', { name: /HIST101/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Link course' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));

    await fireEvent.input(title, { target: { value: 'Latest title' } });
    await fireEvent.input(content, { target: { value: 'Latest content' } });
    resolveFirstSave({ ok: true, data: {} });

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Saved')).toBeNull();
    expect(JSON.parse((mockApiFetch.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      title: 'Latest title',
      content: 'Latest content',
      links: [{ course_id: 'course-1' }],
    });

    resolveLatestSave({ ok: true, data: {} });
    await screen.findByText('Saved');
  });

  it('keeps the editable draft and enables retry after a failed save', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ ok: false, error: 'Connection lost', reason: 'network' })
      .mockResolvedValueOnce({ ok: true, data: {} });

    render(NoteEditor, { props: { note, noteId: note.id, coursesWithKcs } });
    const title = screen.getByPlaceholderText('Note title') as HTMLInputElement;
    const content = screen.getByPlaceholderText('Write your note here... Markdown supported.') as HTMLTextAreaElement;

    await fireEvent.input(title, { target: { value: 'Recovered title' } });
    await fireEvent.input(content, { target: { value: 'Recoverable draft' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add links' }));
    await fireEvent.click(screen.getByRole('button', { name: /HIST101/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Link course' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Connection lost');
    expect(content.value).toBe('Recoverable draft');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved');
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse((mockApiFetch.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
      title: 'Recovered title',
      content: 'Recoverable draft',
      links: [{ course_id: 'course-1' }],
    });
  });

  it('warns before navigation while an editable draft remains unsaved', async () => {
    render(NoteEditor, { props: { note, noteId: note.id, coursesWithKcs } });
    const title = screen.getByPlaceholderText('Note title') as HTMLInputElement;
    const content = screen.getByPlaceholderText('Write your note here... Markdown supported.') as HTMLTextAreaElement;

    await fireEvent.input(title, { target: { value: 'Draft title before navigation' } });
    await fireEvent.input(content, { target: { value: 'Draft before navigation' } });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(title.value).toBe('Draft title before navigation');
    expect(content.value).toBe('Draft before navigation');
  });

  it('shows human link labels, exposes picker state, and deduplicates links', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: true, data: {} });

    render(NoteEditor, { props: { note, noteId: note.id, coursesWithKcs } });
    const addLinks = screen.getByRole('button', { name: 'Add links' });
    expect(addLinks.getAttribute('aria-expanded')).toBe('false');
    expect(addLinks.getAttribute('aria-controls')).toBe('note-link-picker');

    await fireEvent.click(addLinks);
    expect(addLinks.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('note-link-picker')).not.toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: /HIST101/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Link course' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Link course' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Spaced repetition' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Spaced repetition' }));

    expect(document.querySelector('.link-badge.course')?.textContent?.trim()).toBe('HIST101 · History');
    expect(document.querySelector('.link-badge.kc')?.textContent?.trim()).toBe('Spaced repetition');

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse((mockApiFetch.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      links: [{ course_id: 'course-1' }, { kc_id: 'kc-1' }],
    });
  });
});
