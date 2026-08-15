<script lang="ts">
  // Mobile bottom-sheet primitive (M1/S2). Replaces the desktop `.popover`
  // recipe at ≤767px for the four header islands, and hosts the mobile
  // presentation of EventPopover/CreateSessionPopover (P2) and the route
  // modals' inner surfaces where applicable. Frozen contract — see
  // docs/design/mobile-shell.md "Sheet contract".
  //
  // Portaled to <body> (via portalToBody) because a sheet triggered from the
  // header sits inside the header's own backdrop-filter containing block,
  // which would otherwise trap `position: fixed`.
  import type { Snippet } from 'svelte';
  import { portalToBody } from '../../lib/actions/portal';
  import { scrollLock } from '../../lib/actions/scrollLock';
  import { focusTrap } from '../../lib/actions/focusTrap';

  interface Props {
    open: boolean;
    onClose: () => void;
    title: string;
    children: Snippet;
  }

  let { open, onClose, title, children }: Props = $props();

  // Escape-to-close. Body scroll lock lives in the shared scrollLock action
  // (use:scrollLock below); focus trap/restore in the shared focusTrap
  // action (use:focusTrap below) — both mount for exactly the sheet's open
  // lifetime, same as this effect.
  $effect(() => {
    if (!open) return;

    // Joins the same "block escape" convention as the planner/tasks route
    // layers (__plannerBlockEscape / __tasksBlockEscape): while a sheet is
    // open, those pages' own Escape handlers must not also react to the key
    // a sheet just consumed. Sheets don't currently nest anything that needs
    // to claim Escape before the sheet itself does, so our own handler below
    // closes unconditionally.
    (window as unknown as Record<string, boolean>).__plannerBlockEscape = true;
    (window as unknown as Record<string, boolean>).__tasksBlockEscape = true;

    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeydown);

    return () => {
      (window as unknown as Record<string, boolean>).__plannerBlockEscape = false;
      (window as unknown as Record<string, boolean>).__tasksBlockEscape = false;
      window.removeEventListener('keydown', onKeydown);
    };
  });
</script>

{#if open}
  <div class="sheet-layer" use:portalToBody use:scrollLock>
    <div class="sheet-scrim" role="presentation" onclick={onClose}></div>
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-label={title} use:focusTrap>
      <!-- Visual affordance only — no drag-to-dismiss this pass (plan Part 1,
           "Sheet primitive"). Dismissal is scrim tap, close button, or Escape. -->
      <div class="grab-handle" aria-hidden="true"></div>
      <div class="sheet-head">
        <span class="sheet-title">{title}</span>
        <button type="button" class="close-btn" onclick={onClose} aria-label="Close">
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div class="sheet-body">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .sheet-layer {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet);
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .sheet-scrim {
    position: absolute;
    inset: 0;
    /* Route-modal scrim recipe (planner.astro/tasks.astro's .scrim). */
    background: color-mix(in oklch, var(--text) 20%, transparent);
    animation: sheet-scrim-in var(--motion-base) var(--ease);
  }

  .sheet-panel {
    position: relative;
    z-index: 1;
    width: 100%;
    max-height: 85vh;
    max-height: 85dvh;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: var(--shadow-pop);
    padding-bottom: env(safe-area-inset-bottom);
    overflow: hidden;
    animation: sheet-panel-in var(--motion-base) var(--ease);
  }

  .grab-handle {
    flex-shrink: 0;
    width: 36px;
    height: 4px;
    margin: 10px auto 2px;
    border-radius: 999px;
    background: var(--border);
  }

  .sheet-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 16px 12px;
    border-bottom: 1px solid var(--hairline);
  }

  .sheet-title {
    font: 650 15px/1.2 var(--font-display, inherit);
    color: var(--text);
  }

  .close-btn {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    font-size: 1.2rem;
    line-height: 1;
    color: var(--muted);
  }
  .close-btn:hover { background: var(--hover); }

  .sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px 16px;
  }

  @keyframes sheet-scrim-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes sheet-panel-in {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
</style>
