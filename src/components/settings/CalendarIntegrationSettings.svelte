<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/apiClient';

  type Provider = 'google' | 'microsoft';
  interface Connection {
    id: string;
    provider: Provider;
    status: string;
    calendars: Array<{ id: string; name: string; selected: boolean; studyus_owned: boolean; timezone: string | null }>;
  }

  let connections = $state<Connection[]>([]);
  let loading = $state(true);
  let busy = $state<Provider | string | null>(null);
  let message = $state<string | null>(null);
  let needsPermission = $state(false);
  let feedUrl = $state<string | null>(null);

  async function load() {
    const result = await apiFetch<Connection[]>('/api/v1/calendar/connections', {}, 'Could not load calendar connections.');
    if (result.ok) connections = result.data;
    else message = result.error;
    loading = false;
  }

  onMount(() => { void load(); });

  async function connect(provider: Provider) {
    if (busy !== null) return;
    busy = provider;
    message = null;
    needsPermission = false;
    const result = await apiFetch<{ id: string }>(
      '/api/v1/calendar/connections',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider }) },
      'Could not connect calendar.',
    );
    if (!result.ok) {
      message = result.error;
      needsPermission = true;
      busy = null;
      return;
    }
    await load();
    const connection = connections.find((item) => item.id === result.data.id);
    if (connection) await sync(connection);
    busy = null;
  }

  async function sync(connection: Connection) {
    busy = connection.id;
    message = null;
    const result = await apiFetch<{ applied: number }>(
      `/api/v1/calendar/connections/${connection.id}/sync`,
      { method: 'POST' },
      'Calendar sync failed.',
    );
    message = result.ok ? `Synced ${result.data.applied} change${result.data.applied === 1 ? '' : 's'}.` : result.error;
    busy = null;
    await load();
  }

  async function disconnect(connection: Connection) {
    if (!confirm(`Disconnect ${connection.provider === 'google' ? 'Google' : 'Microsoft'} Calendar?`)) return;
    busy = connection.id;
    const result = await apiFetch(`/api/v1/calendar/connections/${connection.id}`, { method: 'DELETE' }, 'Could not disconnect calendar.');
    message = result.ok ? 'Calendar disconnected.' : result.error;
    busy = null;
    await load();
  }

  async function generateFeed() {
    busy = 'feed';
    const result = await apiFetch<{ url: string }>('/api/v1/calendar/feed', { method: 'POST' }, 'Could not create calendar feed.');
    if (result.ok) {
      feedUrl = result.data.url;
      message = 'Private calendar URL generated. Creating another one revokes this URL.';
    } else message = result.error;
    busy = null;
  }

  async function copyFeed() {
    if (!feedUrl) return;
    await navigator.clipboard.writeText(feedUrl);
    message = 'Calendar URL copied.';
  }
</script>

{#if loading}
  <p class="muted">Loading calendar connections…</p>
{:else}
  <div class="connections">
    {#each connections as connection (connection.id)}
      <div class="connection-row">
        <div>
          <strong>{connection.provider === 'google' ? 'Google Calendar' : 'Microsoft Calendar'}</strong>
          <small>{connection.calendars.length} calendars · {connection.status.replace(/_/g, ' ')}</small>
        </div>
        <div class="row-actions">
          <button class="btn btn-secondary" type="button" disabled={busy !== null} onclick={() => sync(connection)}>
            {busy === connection.id ? 'Syncing…' : 'Sync now'}
          </button>
          <button class="link danger" type="button" disabled={busy !== null} onclick={() => disconnect(connection)}>Disconnect</button>
        </div>
      </div>
    {/each}

    <div class="connect-actions">
      {#if !connections.some((item) => item.provider === 'google')}
        <button class="btn btn-secondary" type="button" disabled={busy !== null} onclick={() => connect('google')}>
          {busy === 'google' ? 'Connecting…' : 'Connect Google'}
        </button>
      {/if}
    </div>

    <div class="feed-row">
      <div><strong>Apple Calendar / ICS</strong><small>Read-only subscription fallback</small></div>
      <button class="btn btn-secondary" type="button" disabled={busy !== null} onclick={generateFeed}>
        {busy === 'feed' ? 'Generating…' : feedUrl ? 'Regenerate URL' : 'Generate private URL'}
      </button>
    </div>
    {#if feedUrl}
      <div class="feed-url"><input readonly value={feedUrl} aria-label="Private calendar subscription URL" /><button type="button" onclick={copyFeed}>Copy</button></div>
    {/if}
  </div>
{/if}

{#if message}<p class="status" role="status">{message}</p>{/if}
{#if needsPermission}<p class="permission"><a href="/account">Grant calendar access in Account</a>, then return here and connect again.</p>{/if}

<style>
  .connections { display: grid; gap: 12px; }
  .connection-row, .feed-row { display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md); }
  strong, small { display:block; }
  small { margin-top:3px;color:var(--muted);font-size:12px;text-transform:capitalize; }
  .row-actions, .connect-actions { display:flex;align-items:center;gap:8px;flex-wrap:wrap; }
  .link { color:var(--muted);font-size:12px; }
  .link.danger { color:var(--danger-ink); }
  .feed-url { display:flex;gap:8px; }
  .feed-url input { flex:1;min-width:0;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text); }
  .feed-url button { color:var(--accent-ink);font-weight:650; }
  .status, .permission { margin:10px 0 0;font-size:12.5px;color:var(--muted); }
  .permission a { color:var(--accent-ink);text-decoration:underline; }
  @media (max-width: 560px) { .connection-row, .feed-row { align-items:flex-start;flex-direction:column; } }
</style>
