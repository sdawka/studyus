<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/apiClient';
  import type { GroupSummary } from './types';

  interface GroupListItem {
    group: GroupSummary;
    role: string;
  }

  interface Props {
    initialGroups?: GroupListItem[] | null;
  }

  let { initialGroups = null }: Props = $props();
  let groups = $state<GroupListItem[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let name = $state('');
  let formError = $state<string | null>(null);
  let creating = $state(false);

  async function loadGroups() {
    loading = true;
    error = null;
    const result = await apiFetch<{ groups: GroupListItem[] }>(
      '/api/v1/groups',
      {},
      'Could not load groups',
    );
    if (result.ok) groups = result.data.groups ?? [];
    else error = result.error;
    loading = false;
  }

  onMount(() => {
    if (initialGroups !== null) {
      groups = initialGroups;
      loading = false;
    } else {
      loadGroups();
    }
  });

  async function createGroup(event: SubmitEvent) {
    event.preventDefault();
    formError = null;
    const trimmed = name.trim();
    if (!trimmed) {
      formError = 'Enter a group name.';
      return;
    }
    creating = true;
    const result = await apiFetch<GroupSummary>(
      '/api/v1/groups',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      },
      'Could not create group',
    );
    if (result.ok) {
      groups = [...groups, { group: result.data, role: 'owner' }].sort((a, b) => a.group.name.localeCompare(b.group.name));
      name = '';
    } else {
      formError = result.error;
    }
    creating = false;
  }
</script>

<div class="groups-page">
  <header class="page-header">
    <div>
      <p class="eyebrow">Shared study spaces</p>
      <h1>Groups</h1>
      <p class="lede">Invite people you study with to share links, files, and scheduled sessions.</p>
    </div>
    <a class="button secondary" href="/dashboard">Back to dashboard</a>
  </header>

  <section class="create-card" aria-labelledby="create-group-title">
    <div>
      <h2 id="create-group-title">Create a group</h2>
      <p>Groups are invite-only. Your private notes, grades, and learning history stay personal.</p>
    </div>
    <form onsubmit={createGroup} novalidate>
      <label for="group-name">Group name</label>
      <div class="form-row">
        <input id="group-name" name="name" type="text" maxlength="100" bind:value={name} aria-invalid={formError ? 'true' : 'false'} />
        <button class="button primary" type="submit" disabled={creating}>
          {creating ? 'Creating…' : 'Create group'}
        </button>
      </div>
      {#if formError}<p class="error" role="alert">{formError}</p>{/if}
    </form>
  </section>

  <section aria-labelledby="your-groups-title">
    <div class="section-heading">
      <h2 id="your-groups-title">Your groups</h2>
      {#if !loading}<span class="count">{groups.length}</span>{/if}
    </div>
    {#if loading}
      <p class="status" role="status" aria-live="polite">Loading groups…</p>
    {:else if error}
      <div class="state-card" role="alert">
        <p>{error}</p>
        <button class="button secondary" type="button" onclick={loadGroups}>Try again</button>
      </div>
    {:else if groups.length === 0}
      <div class="state-card empty-state">
        <h3>No groups yet</h3>
        <p>Create one above, then invite the people you learn with.</p>
      </div>
    {:else}
      <div class="group-grid">
        {#each groups as item (item.group.id)}
          <a class="group-card" href={`/groups/${item.group.id}`}>
            <span class="group-mark" aria-hidden="true">{item.group.name.slice(0, 1).toUpperCase()}</span>
            <span class="group-copy">
              <strong>{item.group.name}</strong>
              <span>{item.role === 'owner' ? 'Owner' : 'Member'} · {item.group.state === 'read_only' ? 'Read-only' : 'Shared space'}</span>
            </span>
            <span class="arrow" aria-hidden="true">→</span>
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .groups-page { display: grid; gap: 2rem; max-width: 920px; margin: 0 auto; }
  .page-header, .section-heading, .form-row, .group-card { display: flex; align-items: center; }
  .page-header { justify-content: space-between; gap: 1rem; }
  h1, h2, h3, p { margin: 0; }
  h1 { margin-top: .2rem; }
  h2 { font: 650 1.1rem/1.2 var(--font-title, var(--font-body)); }
  .eyebrow { color: var(--accent); font: 650 .72rem/1 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
  .lede, .create-card p, .state-card p { color: var(--muted); margin-top: .5rem; max-width: 58ch; }
  .button { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .62rem .85rem; font: 600 .85rem/1 var(--font-title, var(--font-body)); cursor: pointer; text-decoration: none; white-space: nowrap; }
  .button.primary { background: var(--accent); color: var(--accent-contrast); border-color: var(--accent); }
  .button.secondary { color: var(--text); background: var(--surface); }
  .button:disabled { opacity: .55; cursor: wait; }
  .create-card, .state-card, .group-card { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
  .create-card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, .9fr); gap: 1.5rem; padding: 1.2rem; }
  .create-card form { display: grid; gap: .45rem; }
  label { font-size: .78rem; font-weight: 650; color: var(--muted); }
  input { width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text); padding: .65rem .7rem; font: inherit; }
  input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .form-row { gap: .55rem; }
  .error { color: var(--danger); font-size: .82rem; }
  .section-heading { gap: .55rem; }
  .count { color: var(--muted); font-size: .78rem; }
  .status { color: var(--muted); padding: 1.5rem 0; }
  .state-card { padding: 1.2rem; }
  .state-card .button { margin-top: 1rem; }
  .empty-state { border-style: dashed; }
  .empty-state h3 { font-size: 1rem; }
  .group-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: .8rem; margin-top: .8rem; }
  .group-card { gap: .8rem; padding: .95rem; color: var(--text); text-decoration: none; transition: border-color var(--motion-fast) var(--ease), transform var(--motion-fast) var(--ease); }
  .group-card:hover { border-color: var(--accent); transform: translateY(-1px); }
  .group-mark { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; flex: none; border-radius: var(--radius-md); background: var(--accent-soft); color: var(--accent-ink); font-weight: 700; }
  .group-copy { display: grid; gap: .25rem; min-width: 0; }
  .group-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .group-copy span { color: var(--muted); font-size: .78rem; }
  .arrow { margin-left: auto; color: var(--muted); font-size: 1.1rem; }
  @media (max-width: 600px) {
    .page-header { align-items: flex-start; flex-direction: column; }
    .create-card { grid-template-columns: 1fr; }
    .form-row { align-items: stretch; flex-direction: column; }
    .button { justify-content: center; text-align: center; }
  }
</style>
