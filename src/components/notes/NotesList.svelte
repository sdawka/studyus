<script lang="ts">
  interface Note {
    id: string;
    title: string;
    content: string;
    updated_at: string;
    links: Array<{ course_id?: string; kc_id?: string }>;
  }

  interface Props {
    initialNotes: Note[];
  }

  let { initialNotes } = $props();
  let notes = $state<Note[]>(initialNotes);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function createNewNote() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/v1/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled note', content: '' }),
      });

      if (!res.ok) {
        const json = await res.json();
        error = json?.error?.message ?? 'Failed to create note';
        return;
      }

      const json = await res.json();
      const newNote = json.data;
      window.location.href = `/notes/${newNote.id}`;
    } catch (err) {
      error = 'Network error, please try again.';
    } finally {
      loading = false;
    }
  }

  function formatDate(dateStr: string) {
    try {
      const date = new Date(dateStr);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
      } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
      }
    } catch {
      return dateStr;
    }
  }
</script>

<div class="notes-container">
  <div class="toolbar">
    <button class="btn-primary" onclick={createNewNote} disabled={loading}>
      {loading ? 'Creating…' : 'New note'}
    </button>
  </div>

  {#if error}
    <p class="error-message">{error}</p>
  {/if}

  {#if notes.length === 0}
    <div class="zero-state">
      <p>You haven't created any notes yet.</p>
      <p>Start by creating your first note to organize your thoughts and learnings.</p>
      <button class="btn-primary" onclick={createNewNote} disabled={loading}>
        Create your first note
      </button>
    </div>
  {:else}
    <div class="notes-list">
      {#each notes as note (note.id)}
        <a href={`/notes/${note.id}`} class="note-card">
          <div class="note-header">
            <h3>{note.title || 'Untitled note'}</h3>
            <span class="note-date">{formatDate(note.updated_at)}</span>
          </div>
          {#if note.links.length > 0}
            <div class="note-chips">
              {#each note.links as link}
                {#if link.course_id}
                  <span class="chip">{link.course_id}</span>
                {/if}
                {#if link.kc_id}
                  <span class="chip">{link.kc_id}</span>
                {/if}
              {/each}
            </div>
          {/if}
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .notes-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .toolbar {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--surface);
    border: none;
    border-radius: 8px;
    padding: 0.65rem 1rem;
    font-size: 0.95rem;
    cursor: pointer;
    font-weight: 500;
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(0.94);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .error-message {
    background: var(--danger-soft);
    color: var(--danger-ink);
    padding: 0.75rem 1rem;
    border-radius: 8px;
    font-size: 0.9rem;
    margin: 0;
  }

  .zero-state {
    text-align: center;
    padding: 3rem 2rem;
    color: var(--muted);
  }

  .zero-state p {
    font-size: 1rem;
    margin: 0.5rem 0;
  }

  .zero-state p:first-child {
    font-weight: 500;
    color: var(--text);
  }

  .zero-state button {
    margin-top: 1.5rem;
  }

  .notes-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .note-card {
    display: flex;
    flex-direction: column;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    text-decoration: none;
    color: inherit;
    background: var(--surface);
    transition: all 0.2s;
  }

  .note-card:hover {
    border-color: var(--accent);
    box-shadow: 0 4px 8px color-mix(in oklch, var(--accent) 10%, transparent);
  }

  .note-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .note-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    flex: 1;
  }

  .note-date {
    font-size: 0.8rem;
    color: var(--muted);
    white-space: nowrap;
  }

  .note-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .chip {
    font-size: 0.8rem;
    padding: 0.3rem 0.6rem;
    background: var(--surface-2);
    border-radius: 4px;
    color: var(--muted);
  }
</style>
