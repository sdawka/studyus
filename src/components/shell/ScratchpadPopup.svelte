<script lang="ts">
  import { bindPopoverDismiss } from './popover.svelte.ts';

  interface Course {
    id: string;
    code: string;
    title: string;
  }

  interface Props {
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    courses?: Course[];
  }

  let { open, onToggle, onClose, courses = [] }: Props = $props();

  const STORAGE_KEY = 'sb:scratch';

  let anchorEl: HTMLElement | null = null;
  let textareaEl: HTMLTextAreaElement | null = null;
  let draft = $state(typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) ?? '' : '');
  let selectedCourseId = $state('');
  let saving = $state(false);
  let savedNoteId = $state<string | null>(null);

  // Esc closes without losing the draft — persist on every keystroke so a
  // dismiss (or accidental navigation) never drops unsaved text.
  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    if (draft.trim()) localStorage.setItem(STORAGE_KEY, draft);
    else localStorage.removeItem(STORAGE_KEY);
  });

  $effect(() => {
    if (open) {
      savedNoteId = null;
      queueMicrotask(() => textareaEl?.focus());
    }
  });

  bindPopoverDismiss({ isOpen: () => open, close: () => onClose(), anchorEl: () => anchorEl });

  async function save() {
    if (!draft.trim()) return;
    saving = true;
    try {
      const firstLine = draft.split('\n')[0].trim();
      const title = firstLine || `Scratch — ${new Date().toLocaleDateString()}`;
      const links = selectedCourseId ? [{ course_id: selectedCourseId }] : [];
      const res = await fetch('/api/v1/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: draft, links }),
      });
      if (res.ok) {
        const json = await res.json();
        savedNoteId = json.data.id;
        draft = '';
        selectedCourseId = '';
      }
    } finally {
      saving = false;
    }
  }
</script>

<div class="popover-anchor" bind:this={anchorEl}>
  <button type="button" class="icon-btn" onclick={onToggle} aria-expanded={open} title="Scratchpad" aria-label="Scratchpad">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 20h4L19.5 8.5a2 2 0 0 0-2.83-2.83L6 17v3ZM14.5 6.5l3 3" />
    </svg>
  </button>

  {#if open}
    <div class="panel" role="menu">
      <span class="kicker">Scratchpad</span>

      {#if savedNoteId}
        <p class="saved">Saved.</p>
        <a class="footer-link" href={`/notes/${savedNoteId}`}>Open in editor →</a>
      {:else}
        <textarea
          bind:this={textareaEl}
          bind:value={draft}
          placeholder="Jot something down…"
          rows="6"
        ></textarea>

        <label class="course-select">
          <span>Save to</span>
          <select bind:value={selectedCourseId}>
            <option value="">General</option>
            {#each courses as c (c.id)}
              <option value={c.id}>{c.code} — {c.title}</option>
            {/each}
          </select>
        </label>

        <button type="button" class="save-btn" onclick={save} disabled={saving || !draft.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .popover-anchor { position: relative; }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 999px;
    color: var(--muted);
  }
  .icon-btn:hover { background: var(--hover); }

  .panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 300px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 10px);
    box-shadow: var(--shadow-pop);
    z-index: 50;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  textarea {
    width: 100%;
    resize: vertical;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    font: inherit;
    font-size: 13px;
    background: var(--surface);
    color: var(--text);
  }

  .course-select {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .course-select select {
    flex: 1;
    min-width: 0;
    padding: 5px 7px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 6px);
    background: var(--surface);
    color: var(--text);
    font-size: 12.5px;
  }

  .save-btn {
    padding: 7px;
    border-radius: var(--radius-sm, 6px);
    background: var(--accent);
    color: var(--accent-ink, white);
    font-size: 13px;
    font-weight: 600;
  }
  .save-btn:disabled { opacity: 0.5; }

  .saved { font-size: 13px; color: var(--good-ink, var(--text)); padding: 6px 2px; }

  .footer-link {
    text-align: center;
    padding: 6px;
    font-size: 12.5px;
    font-weight: 550;
    color: var(--accent);
  }
</style>
