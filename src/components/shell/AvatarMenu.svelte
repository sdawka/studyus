<script lang="ts">
  import { bindPopoverDismiss } from './popover.svelte.ts';

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

  async function logout() {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Origin: window.location.origin },
    });
    window.location.href = '/login';
  }
</script>

<div class="popover-anchor" bind:this={anchorEl}>
  <button type="button" class="avatar" onclick={onToggle} aria-expanded={open} title={name} aria-label="Account menu">
    {initials}
  </button>

  {#if open}
    <div class="popover panel" role="menu" style="--pop-w: var(--pop-w-sm)">
      <a class="row" href="/profile" onclick={onClose}>Profile</a>
      <a class="row" href="/settings" onclick={onClose}>Settings</a>
      <div class="divider"></div>
      <button type="button" class="row danger" onclick={logout}>Logout</button>
    </div>
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
