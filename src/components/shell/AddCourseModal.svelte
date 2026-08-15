<script lang="ts">
  // Global "Add course" modal, mounted once in AppShell (client:idle). Has no
  // trigger of its own — the sidebar's "+ Add course" button dispatches
  // `window` CustomEvent 'open-add-course' (Sidebar.astro::#add-course-btn)
  // and this listens for it, same decoupling as LogEventModal.
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/apiClient';
  import { scrollLock } from '../../lib/actions/scrollLock';
  import { focusTrap } from '../../lib/actions/focusTrap';

  // Same spaced hue list the server cycles through for auto-assignment
  // (src/lib/services/courses.ts::COLOR_HUES), minus the trailing 45 —
  // the modal only needs 8 swatches plus "auto".
  const SWATCH_HUES = [235, 25, 150, 305, 65, 190, 340, 105];

  let open = $state(false);
  let code = $state('');
  let title = $state('');
  let term = $state('');
  let credits = $state('');
  let instructor = $state('');
  let selectedHue = $state<number | null>(null);
  let existingTerms = $state<string[]>([]);
  let submitting = $state(false);
  let submitError = $state<string | null>(null);

  onMount(() => {
    window.addEventListener('open-add-course', openModal);
    return () => window.removeEventListener('open-add-course', openModal);
  });

  async function loadTerms() {
    // Non-fatal on failure — the datalist is just a convenience.
    const result = await apiFetch<{ term: string | null }[]>('/api/v1/courses');
    if (result.ok) {
      const terms = result.data.map((c) => c.term).filter((t): t is string => !!t);
      existingTerms = [...new Set(terms)];
    }
  }

  function openModal() {
    open = true;
    submitError = null;
    void loadTerms();
  }

  function closeModal() {
    open = false;
    resetForm();
  }

  // Escape-to-close — same latent gap as LogEventModal (identical
  // full-viewport `.overlay` pattern, click-outside-only dismissal), fixed
  // for consistency once the FAB→sheet composite flow surfaced it there.
  $effect(() => {
    if (!open) return;
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal();
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  function resetForm() {
    code = '';
    title = '';
    term = '';
    credits = '';
    instructor = '';
    selectedHue = null;
    submitError = null;
  }

  async function submit() {
    if (!code.trim() || !title.trim()) return;
    submitting = true;
    submitError = null;
    try {
      const body: Record<string, unknown> = { code: code.trim(), title: title.trim() };
      if (term.trim()) body.term = term.trim();
      if (credits.trim() !== '') body.credits = Number(credits);
      if (instructor.trim()) body.instructor = instructor.trim();
      if (selectedHue !== null) body.color_hue = selectedHue;

      const result = await apiFetch<{ slug: string }>(
        '/api/v1/courses',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        'Failed to create course',
      );
      if (!result.ok) {
        submitError = result.error;
        return;
      }

      resetForm();
      open = false;
      window.location.href = `/courses/${result.data.slug}`;
    } finally {
      submitting = false;
    }
  }
</script>

{#if open}
  <div class="overlay" role="presentation" onclick={closeModal} use:scrollLock>
    <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()} use:focusTrap>
      <div class="modal-header">
        <h2>Add course</h2>
        <button type="button" class="icon-btn" onclick={closeModal} aria-label="Close">×</button>
      </div>

      <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
        <label>
          Code
          <input type="text" bind:value={code} maxlength="20" required placeholder="CS 101" />
        </label>

        <label>
          Title
          <input type="text" bind:value={title} required placeholder="Intro to Computer Science" />
        </label>

        <label>
          Term
          <input type="text" bind:value={term} list="add-course-terms" placeholder="Fall 2026" />
          <datalist id="add-course-terms">
            {#each existingTerms as t (t)}
              <option value={t}></option>
            {/each}
          </datalist>
        </label>

        <div class="row">
          <label>
            Credits
            <input type="number" bind:value={credits} min="0" step="1" />
          </label>

          <label>
            Instructor
            <input type="text" bind:value={instructor} />
          </label>
        </div>

        <fieldset class="color-field">
          <legend>Color</legend>
          <div class="swatches">
            <button
              type="button"
              class="swatch auto"
              class:selected={selectedHue === null}
              onclick={() => (selectedHue = null)}
              aria-label="Auto"
              title="Auto"
            >auto</button>
            {#each SWATCH_HUES as hue (hue)}
              <button
                type="button"
                class="swatch"
                class:selected={selectedHue === hue}
                style={`--course-h: ${hue}`}
                onclick={() => (selectedHue = hue)}
                aria-label={`Hue ${hue}`}
                title={`Hue ${hue}`}
              ></button>
            {/each}
          </div>
        </fieldset>

        {#if submitError}
          <p class="error">{submitError}</p>
        {/if}

        <button type="submit" class="primary" disabled={submitting || !code.trim() || !title.trim()}>
          {submitting ? 'Adding…' : 'Add course'}
        </button>
      </form>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in oklch, var(--text) 40%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--surface);
    color: var(--text);
    border-radius: var(--radius-lg, 12px);
    padding: 1.5rem;
    width: 420px;
    max-width: 90vw;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: var(--shadow-pop);
  }
  .modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  .modal-header h2 { margin: 0; font-size: 1.1rem; }
  .icon-btn { background: none; border: none; font-size: 1.3rem; cursor: pointer; color: var(--muted); line-height: 1; }
  form { display: flex; flex-direction: column; gap: 0.85rem; }
  .row { display: flex; gap: 0.85rem; }
  .row label { flex: 1; }
  label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.88rem; color: var(--muted); }
  input {
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 8px);
    font-size: 0.9rem;
    font-family: inherit;
    background: var(--surface);
    color: var(--text);
  }
  fieldset.color-field {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  fieldset.color-field legend {
    font-size: 0.88rem;
    color: var(--muted);
    padding: 0;
  }
  .swatches { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    background: var(--course, var(--border));
    cursor: pointer;
    padding: 0;
  }
  .swatch.selected { border-color: var(--text); }
  .swatch.auto {
    width: auto;
    height: 28px;
    border-radius: 14px;
    padding: 0 10px;
    background: var(--surface-2, var(--hover));
    color: var(--muted);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .primary {
    background: var(--accent);
    color: var(--surface);
    border: none;
    border-radius: var(--radius-sm, 8px);
    padding: 0.6rem;
    font-size: 0.92rem;
    cursor: pointer;
  }
  .primary:disabled { opacity: 0.6; cursor: default; }
  .error { color: var(--danger); font-size: 0.85rem; margin: 0; }

  /* Mobile restyle (CSS only): bottom-anchored full-width sheet-like modal
     instead of a centered card — matches Sheet.svelte's visual language
     without depending on the component (this stays a plain modal). */
  @media (max-width: 767px) {
    .overlay { align-items: flex-end; }
    .modal {
      width: 100%;
      max-width: 100%;
      max-height: 90vh;
      max-height: 90dvh;
      border-radius: var(--radius-lg, 12px) var(--radius-lg, 12px) 0 0;
      padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
    }
  }
</style>
