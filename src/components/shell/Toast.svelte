<script lang="ts">
  // Global toast island — mounted once in AppShell.astro as a direct body
  // child (NOT inside <main>: main has container-type set, which makes it
  // the containing block for position:fixed descendants, so a fixed layer
  // in there only covers main's box instead of the viewport — same reason
  // BottomNav and the overlay slot live outside .shell-main).
  //
  // Watches tasksError directly (rather than making every task mutator call
  // pushToast itself) so a failed optimistic toggle/delete/add anywhere in
  // the app surfaces here without each call site remembering to do it.
  // Only a *new* non-null value becomes a toast — re-renders of the same
  // message (e.g. a second component reading the same error atom) don't
  // double-queue it.
  import { toasts, dismissToast, pushToast } from '../../lib/stores/toast';
  import { tasksError } from '../../lib/stores/tasks';

  let lastTasksError: string | null = null;

  $effect(() => {
    const err = $tasksError;
    if (err && err !== lastTasksError) pushToast(err, 'error');
    lastTasksError = err;
  });
</script>

<div class="toast-stack" role="status" aria-live="polite">
  {#each $toasts as t (t.id)}
    <div class="toast" class:toast-error={t.kind === 'error'} class:toast-success={t.kind === 'success'}>
      <span class="toast-msg">{t.message}</span>
      <button type="button" class="toast-dismiss" onclick={() => dismissToast(t.id)} aria-label="Dismiss notification">×</button>
    </div>
  {/each}
</div>

<style>
  /* Desktop default: a quiet bottom-right stack, clear of any popovers.
     Mobile (below) recenters above the tab bar instead — bottom-right on a
     narrow phone viewport would sit under a thumb or the FAB. */
  .toast-stack {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
    width: min(340px, calc(100vw - 40px));
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--muted);
    border-radius: var(--radius-md, 8px);
    box-shadow: var(--shadow-pop);
    pointer-events: auto;
    animation: toast-in var(--motion-base, 0.2s) var(--ease, ease-out);
  }

  .toast-error { border-left-color: var(--danger); }
  .toast-success { border-left-color: var(--good); }

  .toast-msg {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: var(--text);
    overflow-wrap: break-word;
  }

  .toast-dismiss {
    background: none;
    color: var(--muted);
    flex-shrink: 0;
    font-size: 15px;
    line-height: 1;
    padding: 0 2px;
  }
  .toast-dismiss:hover { color: var(--text); }

  @keyframes toast-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Mobile shell cutover breakpoint (see docs/design/mobile-shell.md) — the
     tab bar occupies the bottom-right area a desktop toast would use, and
     --tabbar-h/safe-area only matter once that bar is actually on screen. */
  @media (max-width: 767px) {
    .toast-stack {
      left: 50%;
      right: auto;
      transform: translateX(-50%);
      bottom: calc(12px + var(--tabbar-h) + env(safe-area-inset-bottom));
      width: min(420px, calc(100vw - 24px));
    }
  }
</style>
