<script lang="ts">
  // The popover's footer: where this item can take you, and whether it can be
  // removed from here at all.
  //
  // Manual-source logged events can be deleted; seeded/session/tutor events
  // and deadlines cannot. study_session has its own DELETE endpoint (v1.6)
  // with an inline confirm step, rather than reusing the instant-delete path
  // — class_session has no DELETE endpoint at all (attendance is corrected
  // via PATCH, not by removing the row), so it gets no delete affordance.
  import type { CalendarItem } from '../../../lib/types/calendar';
  import { apiFetch } from '../../../lib/apiClient';

  let {
    item,
    plannerLink,
    onDeleted,
    onClose,
  }: {
    item: CalendarItem;
    plannerLink: string | null | undefined;
    onDeleted: (() => void) | undefined;
    onClose: () => void;
  } = $props();

  let deleting = $state(false);
  let deleteError = $state<string | null>(null);
  let deleteConfirming = $state(false);

  const canDeleteEvent = $derived(item.type === 'event_logged' && item.details?.source === 'manual');
  const canDeleteSession = $derived(item.type === 'study_session');

  async function handleDelete() {
    if (canDeleteEvent) {
      deleting = true;
      deleteError = null;
      try {
        const result = await apiFetch(`/api/v1/events/${item.id}`, { method: 'DELETE' }, 'Could not delete this event.');
        if (!result.ok) {
          deleteError = result.error;
          return;
        }
        onDeleted?.();
        onClose();
      } finally {
        deleting = false;
      }
      return;
    }
    if (canDeleteSession) {
      if (!deleteConfirming) {
        deleteConfirming = true;
        return;
      }
      deleting = true;
      deleteError = null;
      try {
        const result = await apiFetch(`/api/v1/sessions/${item.id}`, { method: 'DELETE' }, 'Could not delete this session.');
        if (!result.ok) {
          deleteError = result.error;
          deleteConfirming = false;
          return;
        }
        onDeleted?.();
        onClose();
      } finally {
        deleting = false;
      }
    }
  }
</script>

{#if deleteError}<p class="pop-error">{deleteError}</p>{/if}
<div class="pop-actions">
  {#if item.href}
    <a class="btn btn-secondary" href={item.href}>Open →</a>
  {/if}
  {#if plannerLink}
    <a class="btn btn-secondary" href={plannerLink}>Open in planner →</a>
  {/if}
  {#if canDeleteEvent}
    <button type="button" class="btn pop-delete" onclick={handleDelete} disabled={deleting}>
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  {/if}
  {#if canDeleteSession}
    {#if deleteConfirming}
      <span class="confirm-row">
        <span class="confirm-label">Delete this session?</span>
        <button type="button" class="btn pop-delete" onclick={handleDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Confirm'}</button>
        <button type="button" class="btn btn-secondary" onclick={() => (deleteConfirming = false)} disabled={deleting}>Cancel</button>
      </span>
    {:else}
      <button type="button" class="btn pop-delete" onclick={handleDelete}>Delete</button>
    {/if}
  {/if}
</div>

<style>
  .pop-error {
    color: var(--danger);
    font-size: 12px;
  }
  .pop-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 2px;
  }
  .pop-delete {
    background: var(--danger-soft);
    color: var(--danger-ink);
    border: 1px solid transparent;
    transition: border-color var(--motion-fast) var(--ease), filter var(--motion-fast) var(--ease);
  }
  .pop-delete:hover { border-color: var(--danger); filter: brightness(0.97); }
  .confirm-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .confirm-label {
    font-size: 12px;
    color: var(--text);
  }
</style>
