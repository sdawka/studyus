<script lang="ts">
  import { bindPopoverDismiss } from './popover.svelte.ts';

  interface Notification {
    id: string;
    type: 'assessment_due' | 'task_overdue' | 'kc_review' | 'session_unfinished' | 'grade_recorded';
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

  const TYPE_ICON: Record<Notification['type'], string> = {
    assessment_due: '📅',
    task_overdue: '⏰',
    kc_review: '🔁',
    session_unfinished: '⏳',
    grade_recorded: '✅',
  };

  function courseCode(id?: string | null) {
    return courses.find((c) => c.id === id)?.code;
  }

  function relativeTime(iso: string) {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.round(ms / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.round(hr / 24)}d ago`;
  }

  async function fetchUnreadCount() {
    try {
      const res = await fetch('/api/v1/notifications?unread=1&limit=1');
      if (res.ok) {
        const json = await res.json();
        unreadCount = json.data.unread_count;
      }
    } catch {
      // best-effort; leave stale count on network failure
    }
  }

  async function fetchList() {
    loading = true;
    try {
      const res = await fetch('/api/v1/notifications?limit=15');
      if (res.ok) {
        const json = await res.json();
        notifications = json.data.notifications;
        unreadCount = json.data.unread_count;
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
    if (!n.read_at) {
      notifications = notifications.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
      unreadCount = Math.max(0, unreadCount - 1);
      void fetch(`/api/v1/notifications/${n.id}/read`, { method: 'PATCH' });
    }
    onClose();
    window.location.href = n.href;
  }

  async function markAllRead() {
    notifications = notifications.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }));
    unreadCount = 0;
    await fetch('/api/v1/notifications/read-all', { method: 'POST' });
  }
</script>

<div class="popover-anchor" bind:this={anchorEl}>
  <button type="button" class="icon-btn" onclick={onToggle} aria-expanded={open} title="Notifications" aria-label="Notifications">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 17h12 M6 17a6 6 0 0 1 12 0 M12 3a4 4 0 0 0-4 4v1a6 6 0 0 0 0 0 M10.5 20a1.5 1.5 0 0 0 3 0" />
    </svg>
    {#if unreadCount > 0}
      <span class="badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
    {/if}
  </button>

  {#if open}
    <div class="popover panel" role="menu" style="--pop-w: var(--pop-w-lg)">
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
              <button type="button" class="row" class:unread={!n.read_at} onclick={() => selectNotification(n)}>
                <span class="type-icon">{TYPE_ICON[n.type]}</span>
                <span class="row-body">
                  <span class="row-title">{n.title}</span>
                  <span class="row-meta">
                    {relativeTime(n.created_at)}
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
    </div>
  {/if}
</div>

<style>
  .popover-anchor { position: relative; }

  .badge {
    position: absolute;
    top: 2px;
    right: 2px;
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
