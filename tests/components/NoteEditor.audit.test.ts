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

describe('NoteEditor recovery', () => {
  beforeEach(() => mockApiFetch.mockReset());

  describe('when an older save finishes after a newer edit', () => {
    let observedSaveState: {
      canRetryNewerDraft: boolean;
      falselyReportsNewerDraftSaved: boolean;
    };

    beforeEach(async () => {
      let resolveFirstSave!: (result: { ok: true; data: unknown }) => void;
      mockApiFetch.mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirstSave = resolve; }),
      );

      render(NoteEditor, { props: { note, noteId: note.id, coursesWithKcs: [] } });
      const content = screen.getByPlaceholderText('Write your note here... Markdown supported.') as HTMLTextAreaElement;

      await fireEvent.change(content, { target: { value: 'Saved snapshot' } });
      await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
      expect(JSON.parse((mockApiFetch.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
        content: 'Saved snapshot',
      });

      await fireEvent.change(content, { target: { value: 'Newer unsaved draft' } });
      expect(content.value).toBe('Newer unsaved draft');
      resolveFirstSave({ ok: true, data: {} });

      await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull());
      const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
      observedSaveState = {
        canRetryNewerDraft: !save.disabled,
        falselyReportsNewerDraftSaved: screen.queryByText('Saved') !== null,
      };
    });

    // Known recovery defect: saveNote clears unsavedChanges after any
    // successful response, including a response for an older request payload.
    // Setup lives above so an unexpected render, request, or transition failure
    // remains an ordinary failing test instead of an expected failure.
    it.fails('keeps a newer edit unsaved when an earlier save finishes', () => {
      expect(observedSaveState).toEqual({
        canRetryNewerDraft: true,
        falselyReportsNewerDraftSaved: false,
      });
    });
  });

  it('keeps the editable draft and enables retry after a failed save', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ ok: false, error: 'Connection lost', reason: 'network' })
      .mockResolvedValueOnce({ ok: true, data: {} });

    render(NoteEditor, { props: { note, noteId: note.id, coursesWithKcs: [] } });
    const content = screen.getByPlaceholderText('Write your note here... Markdown supported.') as HTMLTextAreaElement;

    await fireEvent.change(content, { target: { value: 'Recoverable draft' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Connection lost');
    expect(content.value).toBe('Recoverable draft');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved');
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse((mockApiFetch.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
      content: 'Recoverable draft',
    });
  });
});
