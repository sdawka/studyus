<script lang="ts">
  import { bindPopoverDismiss } from './popover.svelte.ts';
  import { apiFetch } from '../../lib/apiClient';
  import { captureBehavioralEvent } from '../../lib/analytics/client';
  import { createNotificationAnalytics } from '../../lib/analytics/engagement';
  import { formatRelativeTime } from '../../lib/plannerDates';
  import { isMobile } from '../../lib/stores/viewport';
  import Sheet from './Sheet.svelte';

  interface Notification {
    id: string;
    type: 'assessment_due' | 'task_overdue' | 'kc_review' | 'session_unfinished' | 'grade_recorded' | 'correction_review';
    title: string;
    body?: string | null;
    course_id?: string | null;
    href: string;
    read_at?: string | null;
    created_at: string;
  }

  interface Course {
    id: string;
    code: string;
  }

  interface Props {
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    courses?: Course[];
  }

  let { open, onToggle, onClose, courses = [] }: Props = $props();

  let anchorEl: HTMLElement | null = null;
  let unreadCount = $state(0);
  let notifications = $state<Notification[]>([]);
  let listLoaded = $state(false);
  let loading = $state(false);
  let openingIds = $state<Set<string>>(new Set());
  const analytics = createNotificationAnalytics(captureBehavioralEvent);

  const TYPE_ICON: Record<Notification['type'], string> = {
    assessment_due: '📅',
    task_overdue: '⏰',
    kc_review: '🔁',
    session_unfinished: '⏳',
    grade_recorded: '✅',
    correction_review: '💡',
  };

  function courseCode(id?: string | null) {
    return courses.find((c) => c.id === id)?.code;
  }

  async function fetchUnreadCount() {
    // Dedicated count endpoint (contract: `{ data: { unread } }`) — the
    // full list endpoint runs the whole notification sweep on every call,
    // which this 60s poll was doing needlessly just to read a badge count.
    // Best-effort; leave stale count on failure.
    const result = await apiFetch<{ unread: number }>('/api/v1/notifications/count');
    if (result.ok) unreadCount = result.data.unread;
  }

  async function fetchList() {
    loading = true;
    try {
      const result = await apiFetch<{ notifications: Notification[]; unread_count: number }>('/api/v1/notifications?limit=15');
      if (result.ok) {
        notifications = result.data.notifications;
        unreadCount = result.data.unread_count;
      }
    } finally {
      loading = false;
      listLoaded = true;
    }
  }

  $effect(() => {
    fetchUnreadCount();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchUnreadCount();
    }, 60_000);
    return () => clearInterval(interval);
  });

  $effect(() => {
    if (open) void fetchList();
  });

  bindPopoverDismiss({ isOpen: () => open, close: () => onClose(), anchorEl: () => anchorEl });

  async function selectNotification(n: Notification) {
    if (openingIds.has(n.id)) return;
    openingIds = new Set(openingIds).add(n.id);
    analytics.opened(n.id, n.type);
    if (!n.read_at) {
      notifications = notifications.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
      unreadCount = Math.max(0, unreadCount - 1);
      void apiFetch(`/api/v1/notifications/${n.id}/read`, { method: 'PATCH' });
    }
    onClose();
    window.location.href = n.href;
  }

  async function markAllRead() {
    notifications = notifications.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }));
    unreadCount = 0;
    await apiFetch('/api/v1/notifications/read-all', { method: 'POST' });
  }
</script>

<div class="popover-anchor" bind:this={anchorEl}>
  <button type="button" class="icon-btn pill-btn" onclick={onToggle} aria-expanded={open} title="Notifications" aria-label="Notifications">
    <span class="icon-wrap">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {#if unreadCount > 0}
        <span class="badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
      {/if}
    </span>
    <span class="pill-label">Notifications</span>
  </button>

  {#snippet panelContent()}
    <div class="panel-head">
      <span class="kicker">Notifications</span>
      {#if unreadCount > 0}
        <button type="button" class="link" onclick={markAllRead}>Mark all read</button>
      {/if}
    </div>
    {#if loading && !listLoaded}
      <p class="empty">Loading…</p>
    {:else if notifications.length === 0}
      <p class="empty">You're all caught up.</p>
    {:else}
      <ul class="list">
        {#each notifications as n (n.id)}
          <li>
            <button type="button" class="row" class:unread={!n.read_at} disabled={openingIds.has(n.id)} onclick={() => selectNotification(n)}>
              <span class="type-icon">{TYPE_ICON[n.type]}</span>
              <span class="row-body">
                <span class="row-title">{n.title}</span>
                <span class="row-meta">
                  {formatRelativeTime(n.created_at)}
                  {#if n.course_id && courseCode(n.course_id)}
                    <span class="course-chip">{courseCode(n.course_id)}</span>
                  {/if}
                </span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}

  {#if open}
    {#if $isMobile}
      <Sheet {open} onClose={onClose} title="Notifications">
        {@render panelContent()}
      </Sheet>
    {:else}
      <div class="popover panel" role="group" aria-label="Notifications" style="--pop-w: var(--pop-w-lg)">
        {@render panelContent()}
      </div>
    {/if}
  {/if}
</div>

<style>
  .popover-anchor { position: relative; }

  /* Pill-on-hover, matching the Record event pill's language: the circular
     icon button widens to reveal a text label. Width transitions to an
     explicit px value (not `auto`) so it actually animates. The badge is
     anchored to the icon itself (not the button) so it stays put — pinned
     to the bell's corner — whether the pill is collapsed or expanded. */
  .pill-btn {
    display: inline-flex;
    align-items: center;
    width: 34px;
    overflow: hidden;
    transition: width var(--motion-base) var(--ease);
  }
  .icon-wrap {
    position: relative;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    margin-left: 8px;
  }
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
    width: 140px;
  }
  .pill-btn:hover .pill-label,
  .pill-btn:focus-visible .pill-label {
    max-width: 100px;
    margin-left: 6px;
    opacity: 1;
  }

  .badge {
    position: absolute;
    top: -4px;
    right: -6px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 999px;
    background: var(--danger);
    color: var(--surface);
    font-size: 9.5px;
    font-weight: 700;
    display: grid;
    place-items: center;
    line-height: 1;
  }

  .panel {
    max-height: 420px;
    overflow-y: auto;
  }

  .link {
    color: var(--accent);
    font-size: 12px;
    font-weight: 550;
  }

  .list { display: flex; flex-direction: column; gap: 2px; }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 8px;
    border-radius: var(--radius-sm, 6px);
    text-align: left;
  }
  .row:hover { background: var(--hover); }
  .row.unread { background: var(--accent-soft); }
  .row.unread:hover { filter: brightness(0.97); }

  .type-icon { font-size: 15px; line-height: 1.4; flex-shrink: 0; }

  .row-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .row-title { font-size: 13px; font-weight: 550; color: var(--text); }
  .row-meta { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); }

  .course-chip {
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--course-soft, var(--hairline));
    color: var(--course-ink, var(--muted));
    font-weight: 600;
  }
</style>
