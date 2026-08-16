<script lang="ts">
  // Floating quick-action cluster for a task row — the header idiom
  // (base.css .icon-btn: round icon-only buttons with title tooltips,
  // grouped on a popover-style surface) brought down to row scale. At rest
  // a row shows content only; the cluster fades in on row hover (fine
  // pointers) or when keyboard focus enters it, and on coarse pointers —
  // where there is no hover to reveal with — a persistent ⋯ disclosure at
  // the row's end toggles it instead. Snooze/delete are low-frequency
  // actions, so one extra tap there beats permanent per-row chrome;
  // completing (the checkbox) stays one tap regardless.
  //
  // Shared by TaskItem and TasksView's parent-with-subtasks row — the
  // reveal selectors below key off both hosts' row classes.
  interface Props {
    canSnooze?: boolean;
    canLog?: boolean;
    busy?: boolean;
    onsnooze?: () => void;
    ondelete?: () => void;
    onlog?: () => void;
  }

  let { canSnooze = false, canLog = false, busy = false, onsnooze, ondelete, onlog }: Props = $props();

  let open = $state(false);
  let anchorEl: HTMLElement | undefined;

  // Outside-tap dismissal for the ⋯ disclosure; the listener only exists
  // while open, so idle rows cost nothing. Capture phase so a tap on an
  // element that stops propagation still closes the cluster.
  $effect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (anchorEl && !anchorEl.contains(e.target as Node)) open = false;
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  });

  function run(action?: () => void) {
    open = false;
    action?.();
  }
</script>

<div class="qa" class:open bind:this={anchorEl}>
  <button
    type="button"
    class="icon-btn qa-more"
    aria-label="Task actions"
    aria-expanded={open}
    disabled={busy}
    onclick={() => (open = !open)}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 12h.01 M12 12h.01 M19 12h.01" />
    </svg>
  </button>
  <div class="qa-cluster" role="group" aria-label="Task actions">
    {#if canLog}
      <button
        type="button"
        class="icon-btn qa-log"
        title="Record a practice event"
        aria-label="Record a practice event"
        disabled={busy}
        onclick={() => run(onlog)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12h4l3-8 4 16 3-8h4" />
        </svg>
      </button>
    {/if}
    {#if canSnooze}
      <button
        type="button"
        class="icon-btn qa-snooze"
        title="Not today — postpone by a day"
        aria-label="Not today — postpone due date by a day"
        disabled={busy}
        onclick={() => run(onsnooze)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      </button>
    {/if}
    <button
      type="button"
      class="icon-btn qa-delete"
      title="Delete task"
      aria-label="Delete task"
      disabled={busy}
      onclick={() => run(ondelete)}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6h18 M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2 M19 6l-.8 13.2a2 2 0 0 1-2 1.8H7.8a2 2 0 0 1-2-1.8L5 6 M10 11v6 M14 11v6" />
      </svg>
    </button>
  </div>
</div>

<style>
  /* Flex item at the row's end. On fine pointers the ⋯ is display:none, so
     this collapses to zero width and the at-rest row shows no chrome at
     all; on coarse pointers the ⋯ reserves its own small footprint in
     normal flow instead of floating over (and hiding) row content. */
  .qa {
    position: relative;
    align-self: stretch;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .qa-more {
    display: none;
    color: var(--muted);
  }
  /* Touch-affordance gate only (mobile-shell.md rule 3) — never layout:
     the cluster itself renders identically, this just swaps which reveal
     affordance exists. */
  @media (hover: none), (pointer: coarse) {
    .qa-more {
      display: grid;
    }
  }

  .qa-cluster {
    position: absolute;
    top: 50%;
    right: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    box-shadow: var(--shadow-pop);
    opacity: 0;
    pointer-events: none;
    transform: translateY(-50%) translateX(6px);
    transition: opacity var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease);
    z-index: 5;
  }

  /* Where the ⋯ exists (coarse pointers), the cluster opens to its LEFT
     (right:100%) instead of overlaying it: tapping ⋯ focuses it, and
     :focus-within (below) reveals the cluster mid-gesture — if the cluster
     still covered the ⋯ at that instant, the tap's click would hit-test
     into the cluster's rightmost button (delete!) instead of the ⋯ it
     started on. Placed AFTER the base .qa-cluster rule: an @media block
     earlier in source order loses the cascade tie to an unwrapped
     same-specificity rule that follows it (same gotcha TasksView.svelte
     documents for its own mobile block). */
  @media (hover: none), (pointer: coarse) {
    .qa-cluster {
      right: calc(100% + 4px);
    }
  }

  .qa:focus-within .qa-cluster,
  .qa.open .qa-cluster {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(-50%) translateX(0);
  }

  /* Row-hover reveal, gated to devices where hover is a real capability —
     mobile browsers' sticky tap-hover would otherwise leave a stray
     visible cluster intercepting taps meant for the row. */
  @media (hover: hover) {
    :global(.task-item:hover) .qa-cluster,
    :global(.task-row:hover) .qa-cluster {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(-50%) translateX(0);
    }
  }

  /* Tighter than the header's 34px — this is row-scale, not shell-scale. */
  .qa-cluster button {
    width: 30px;
    height: 30px;
    color: var(--muted);
  }

  .qa-log:hover,
  .qa-snooze:hover {
    color: var(--accent-ink, var(--accent));
  }
  .qa-delete:hover {
    color: var(--danger-ink, var(--danger));
  }

  button[disabled] {
    opacity: 0.5;
    cursor: default;
  }

  /* Touch-target bump, matching base.css's .icon-btn mobile convention
     (scoped width/height above would otherwise out-specificity it). */
  @media (max-width: 767px) {
    .qa-cluster button {
      width: 44px;
      height: 44px;
    }
  }
</style>
