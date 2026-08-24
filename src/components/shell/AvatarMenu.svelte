<script lang="ts">
  import { bindPopoverDismiss } from './popover.svelte.ts';
  import { isMobile } from '../../lib/stores/viewport';
  import { togglePopover } from '../../lib/stores/ui';
  import Sheet from './Sheet.svelte';

  interface Props {
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    name: string;
    initials: string;
  }

  let { open, onToggle, onClose, name, initials }: Props = $props();

  let anchorEl: HTMLElement | null = null;

  bindPopoverDismiss({ isOpen: () => open, close: () => onClose(), anchorEl: () => anchorEl });

  type ClerkWindow = Window & {
    Clerk?: { signOut: (options?: { redirectUrl?: string }) => Promise<void> | void };
  };

  function logout() {
    const clerk = (window as ClerkWindow).Clerk;
    if (clerk) {
      clerk.signOut({ redirectUrl: '/sign-in' });
      return;
    }
    // Clerk's client script should always be present after the integration
    // initializes. This fallback is useful if the page is offline mid-load.
    window.location.href = '/sign-in';
  }
</script>

<div class="popover-anchor" bind:this={anchorEl}>
  <button type="button" class="avatar" onclick={onToggle} aria-expanded={open} title={name} aria-label="Account menu">
    {initials}
  </button>

  {#snippet menuRows()}
    <a class="row" href="/account" onclick={onClose}>Account</a>
    <a class="row" href="/settings" onclick={onClose}>Settings</a>
    <div class="divider"></div>
    <button type="button" class="row danger" onclick={logout}>Log out</button>
  {/snippet}

  {#if open}
    {#if $isMobile}
      <Sheet {open} onClose={onClose} title="Menu">
        <!-- Mobile-only rows: Scratchpad + Feed have no bottom-nav tab of
             their own (BottomNav is Home/Tasks/Record/Planner/Courses), so
             the avatar sheet covers them, per plan Part 1. Desktop's popover
             is intentionally unchanged — these rows don't exist there. -->
        <button type="button" class="row" onclick={() => togglePopover('scratchpad')}>Scratchpad</button>
        <a class="row" href="/feed" onclick={onClose}>Feed</a>
        <a class="row" href="/corrections" onclick={onClose}>Corrections</a>
        <!-- TEMPORARY docs annotation overlay toggle (docs/product/annotations.md).
             Mobile-only on purpose: the sidebar carries this on desktop and is
             display:none below 767px. Remove with the layer. -->
        {#if import.meta.env.PUBLIC_DOCS_OVERLAY === 'true'}
          <button
            type="button"
            class="row"
            onclick={() => {
              onClose();
              window.dispatchEvent(new CustomEvent('toggle-docs-overlay'));
            }}
          >
            Docs overlay
          </button>
        {/if}
        <div class="divider"></div>
        {@render menuRows()}
      </Sheet>
    {:else}
      <div class="popover panel" role="group" aria-label="Account menu" style="--pop-w: var(--pop-w-sm)">
        {@render menuRows()}
      </div>
    {/if}
  {/if}
</div>

<style>
  .popover-anchor { position: relative; }

  .avatar {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-ink);
    font: 650 12px/1 var(--font-display);
    letter-spacing: 0.02em;
  }

  .panel {
    padding: 6px;
    gap: 0;
  }

  .row {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border-radius: var(--radius-sm, 6px);
    font-size: 13px;
    color: var(--text);
    text-decoration: none;
  }
  .row:hover { background: var(--hover); }
  .row.danger { color: var(--danger-ink, var(--text)); }

  .divider {
    height: 1px;
    background: var(--hairline);
    margin: 4px 2px;
  }
</style>
