<script lang="ts">
  import { bindPopoverDismiss } from './popover.svelte.ts';
  import { courseContext } from '../../lib/stores/courseContext';
  import { isMobile } from '../../lib/stores/viewport';
  import Sheet from './Sheet.svelte';

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

  // On open, default "Save to" to the course we're currently viewing (if
  // any) — but only as a starting point; once the user has touched the
  // select for this open session, respect their choice.
  $effect(() => {
    if (open) {
      savedNoteId = null;
      selectedCourseId = $courseContext?.id ?? '';
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
  <button type="button" class="icon-btn pill-btn" onclick={onToggle} aria-expanded={open} title="Scratchpad" aria-label="Scratchpad">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 20h4L19.5 8.5a2 2 0 0 0-2.83-2.83L6 17v3ZM14.5 6.5l3 3" />
    </svg>
    <span class="pill-label">Scratchpad</span>
  </button>

  {#snippet panelContent()}
    <div class="panel-head">
      <span class="kicker">Scratchpad</span>
    </div>

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

    <a class="footer-link" href="/notes">All notes →</a>
  {/snippet}

  {#if open}
    {#if $isMobile}
      <Sheet {open} onClose={onClose} title="Scratchpad">
        {@render panelContent()}
      </Sheet>
    {:else}
      <div class="popover panel" role="dialog" aria-label="Scratchpad" style="--pop-w: var(--pop-w-md)">
        {@render panelContent()}
      </div>
    {/if}
  {/if}
</div>

<style>
  .popover-anchor { position: relative; }

  /* Pill-on-hover, matching the Record event pill's language: the circular
     icon button widens to reveal a text label. Width transitions to an
     explicit px value (not `auto`) so it actually animates. */
  .pill-btn {
    display: inline-flex;
    align-items: center;
    width: 34px;
    overflow: hidden;
    transition: width var(--motion-base) var(--ease);
  }
  .pill-btn svg { flex-shrink: 0; margin-left: 8px; }
  .pill-label {
    max-width: 0;
    margin-left: 0;
    opacity: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 600;
    transition: max-width var(--motion-base) var(--ease), opacity var(--motion-base) var(--ease),
      margin-left var(--motion-base) var(--ease);
  }
  .pill-btn:hover,
  .pill-btn:focus-visible {
    width: 118px;
  }
  .pill-btn:hover .pill-label,
  .pill-btn:focus-visible .pill-label {
    max-width: 80px;
    margin-left: 6px;
    opacity: 1;
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
    color: var(--accent-contrast);
    font-size: 13px;
    font-weight: 600;
  }
  .save-btn:disabled { opacity: 0.5; }

  .saved { font-size: 13px; color: var(--good-ink, var(--text)); padding: 6px 2px; }
</style>
