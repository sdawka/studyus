<script lang="ts">
  // Client half of /corrections: status filter (client-side only — the
  // server loaded both statuses already) + "mark internalized" mutation via
  // PATCH /api/v1/corrections/:id (docs/api.md v1.7).
  import { apiFetch } from '../../lib/apiClient';
  import { captureBehavioralEvent } from '../../lib/analytics/client';
  import { wholeDaysSince } from '../../lib/analytics/learning';
  import { pushToast } from '../../lib/stores/toast';

  export type Correction = {
    id: string;
    kc_id: string | null;
    kc_name: string | null;
    course_slug: string | null;
    prior_belief: string | null;
    correction: string;
    status: 'active' | 'internalized';
    accepted_at: string;
    last_reminded_at: string | null;
  };

  interface Props {
    initialCorrections: Correction[];
  }
  const { initialCorrections }: Props = $props();

  let corrections = $state<Correction[]>(initialCorrections);
  let filter = $state<'active' | 'internalized' | 'all'>('active');
  let confirmingId = $state<string | null>(null);
  let savingId = $state<string | null>(null);

  const filtered = $derived(filter === 'all' ? corrections : corrections.filter((c) => c.status === filter));

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function requestInternalize(id: string) {
    confirmingId = id;
  }

  function cancelInternalize() {
    confirmingId = null;
  }

  async function confirmInternalize(id: string) {
    savingId = id;
    const res = await apiFetch<Correction>(
      `/api/v1/corrections/${id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'internalized' }) },
      'Could not update that correction right now.',
    );
    savingId = null;
    confirmingId = null;
    if (!res.ok) {
      pushToast(res.error, 'error');
      return;
    }
    corrections = corrections.map((c) => (c.id === id ? res.data : c));
    captureBehavioralEvent({
      name: 'correction_internalized',
      correction_id: res.data.id,
      days_since_accepted: wholeDaysSince(res.data.accepted_at),
    });
    pushToast('Marked internalized.', 'success');
  }
</script>

<div class="ledger">
  {#if corrections.length === 0}
    <div class="empty-state">
      <p class="empty-title">Nothing here yet</p>
      <p class="empty-body">
        Corrections you accept during an absorb session land here, and resurface now and then
        until you mark them internalized.
      </p>
    </div>
  {:else}
    <div class="filter-row" role="tablist" aria-label="Filter corrections">
      {#each [['active', 'Active'], ['internalized', 'Internalized'], ['all', 'All']] as [value, label] (value)}
        <button
          type="button"
          role="tab"
          aria-selected={filter === value}
          class="filter-chip"
          class:active={filter === value}
          onclick={() => (filter = value as typeof filter)}
        >
          {label}
        </button>
      {/each}
    </div>

    {#if filtered.length === 0}
      <p class="empty-filtered">No {filter === 'all' ? '' : filter} corrections.</p>
    {:else}
      <ul class="list">
        {#each filtered as c (c.id)}
          <li class="row">
            <div class="row-head">
              {#if c.kc_name && c.course_slug && c.kc_id}
                <a class="kc-link" href={`/courses/${c.course_slug}/kc/${c.kc_id}`}>{c.kc_name}</a>
              {:else}
                <span class="kc-link general">General correction</span>
              {/if}
              <span class="accepted-date">Accepted {formatDate(c.accepted_at)}</span>
            </div>

            {#if c.prior_belief}
              <p class="prior"><span class="strike">{c.prior_belief}</span></p>
            {/if}
            <p class="correction-text">{c.correction}</p>

            <div class="row-foot">
              {#if c.last_reminded_at}
                <span class="reminded">Last reminded {formatDate(c.last_reminded_at)}</span>
              {/if}
              {#if c.status === 'active'}
                {#if confirmingId === c.id}
                  <span class="confirm-row">
                    <span class="confirm-prompt">Mark internalized?</span>
                    <button type="button" class="confirm-yes" disabled={savingId === c.id} onclick={() => confirmInternalize(c.id)}>
                      {savingId === c.id ? 'Saving…' : 'Yes'}
                    </button>
                    <button type="button" class="confirm-no" disabled={savingId === c.id} onclick={cancelInternalize}>Cancel</button>
                  </span>
                {:else}
                  <button type="button" class="mark-btn" onclick={() => requestInternalize(c.id)}>Mark internalized</button>
                {/if}
              {:else}
                <span class="internalized-tag">Internalized</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .ledger { display: flex; flex-direction: column; gap: 1.1rem; max-width: 680px; }

  .empty-state { padding: 1.5rem; border: 1px dashed var(--border); border-radius: var(--radius-md); }
  .empty-title { margin: 0 0 0.4rem 0; font-weight: 600; }
  .empty-body { margin: 0; color: var(--muted); font-size: 0.9rem; max-width: 480px; }

  .filter-row { display: flex; gap: 0.4rem; }
  .filter-chip {
    padding: 0.4rem 0.8rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    font-size: 0.82rem;
    font-weight: 550;
    cursor: pointer;
    transition: background var(--motion-fast) var(--ease), border-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease);
  }
  .filter-chip:hover { border-color: var(--muted); color: var(--text); }
  .filter-chip.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); }

  .empty-filtered { color: var(--muted); font-size: 0.9rem; }

  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.7rem; }
  .row {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.8rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .row-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap; }
  .kc-link { font-weight: 600; color: var(--accent); text-decoration: none; min-width: 0; }
  .kc-link:hover { text-decoration: underline; }
  .kc-link.general { color: var(--muted); font-weight: 550; }
  .accepted-date { font-size: 0.76rem; color: var(--faint); flex: none; }

  .prior { margin: 0; font-size: 0.86rem; color: var(--muted); }
  .strike { text-decoration: line-through; }
  .correction-text { margin: 0; font-size: 0.94rem; }

  .row-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; flex-wrap: wrap; margin-top: 0.2rem; }
  .reminded { font-size: 0.76rem; color: var(--faint); }

  button { border: none; cursor: pointer; font-size: 0.84rem; font-weight: 550; border-radius: var(--radius-sm); padding: 0.4rem 0.75rem; transition: filter var(--motion-fast) var(--ease), background var(--motion-fast) var(--ease); }
  button:disabled { opacity: 0.6; cursor: default; }
  .mark-btn { background: var(--hover); color: var(--text); margin-left: auto; }
  .mark-btn:hover:not(:disabled) { background: var(--border); }
  .confirm-row { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }
  .confirm-prompt { font-size: 0.82rem; color: var(--muted); }
  .confirm-yes { background: var(--accent); color: var(--surface); }
  .confirm-yes:hover:not(:disabled) { filter: brightness(0.94); }
  .confirm-no { background: none; color: var(--muted); }
  .internalized-tag { margin-left: auto; font-size: 0.78rem; color: var(--good-ink); font-weight: 600; }

  /* main content-box ≤ 480px: accepted-date drops under the kc link instead
     of squeezing the row-head onto one crushed line. */
  @container (max-width: 480px) {
    .row-head { flex-direction: column; align-items: flex-start; gap: 0.2rem; }
  }
</style>
