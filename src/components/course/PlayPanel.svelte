<script lang="ts">
  type Kc = { id: string; name: string; kcType: string; mastery: number | null };
  type Conversation = {
    id: string;
    kcId: string;
    kcName: string;
    mode: string;
    status: 'active' | 'ended';
    createdAt: number;
    endedAt: number | null;
  };

  interface Props {
    courseSlug: string;
    principleKcs: Kc[];
    conceptKcs: Kc[];
    conversations: Conversation[];
    aiEnabled: boolean;
    aiUnavailableReason: 'disabled' | 'provider_not_configured' | null;
  }
  const { courseSlug, principleKcs, conceptKcs, conversations, aiEnabled, aiUnavailableReason }: Props = $props();

  const aiUnavailableMessage = aiUnavailableReason === 'provider_not_configured'
    ? 'The AI tutor is not configured in this environment.'
    : 'The AI tutor is disabled in this environment.';

  const MODE_LABELS: Record<string, string> = {
    recall: 'Recall',
    classify: 'Classify',
    worked_example: 'Worked example',
    self_explain: 'Self-explain',
    interactive_model: 'Interactive model',
    absorb: 'Absorb session',
  };
</script>

<div class="play-panel">
  <section class="section">
    <div class="section-heading">
      <h2>Models &amp; deep dives</h2>
      <span class="ai-label">AI tutor</span>
    </div>
    {#if !aiEnabled}
      <div class="ai-gate" role="status" data-ai-feature="tutor">
        <strong>AI unavailable</strong>
        <span>{aiUnavailableMessage} Understand, practice, and seeded quizzes still work.</span>
      </div>
    {/if}
    {#if principleKcs.length === 0 && conceptKcs.length === 0}
      <p class="placeholder">No principles or concepts to explore yet.</p>
    {:else}
      <div class="card-grid">
        {#each principleKcs as kc (kc.id)}
          <div class="model-card">
            {#if aiEnabled}
              <a class="model-link" href={`/tutor/${kc.id}?entry=course`}>
                <span class="kc-type">Principle</span>
                <span class="kc-name">{kc.name}</span>
              </a>
            {:else}
              <div class="model-link disabled" aria-disabled="true" data-kc-id={kc.id}>
                <span class="kc-type">Principle · AI unavailable</span>
                <span class="kc-name">{kc.name}</span>
              </div>
            {/if}
            <a class="understand-link" href={`/learn/${kc.id}`}>Understand</a>
          </div>
        {/each}
        {#each conceptKcs as kc (kc.id)}
          <div class="model-card secondary">
            {#if aiEnabled}
              <a class="model-link" href={`/tutor/${kc.id}?entry=course`}>
                <span class="kc-type">Concept</span>
                <span class="kc-name">{kc.name}</span>
              </a>
            {:else}
              <div class="model-link disabled" aria-disabled="true" data-kc-id={kc.id}>
                <span class="kc-type">Concept · AI unavailable</span>
                <span class="kc-name">{kc.name}</span>
              </div>
            {/if}
            <a class="understand-link" href={`/learn/${kc.id}`}>Understand</a>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="section">
    <h2>Past explorations</h2>
    {#if conversations.length === 0}
      <p class="placeholder">
        Nothing explored here yet — open a model or concept above to start your first exploration.
      </p>
    {:else}
      <ul class="convo-list">
        {#each conversations as c (c.id)}
          <li>
            <a class="convo-row" href={`/tutor/${c.kcId}?c=${encodeURIComponent(c.id)}&entry=course`}>
              <span class="kc-name">{c.kcName}</span>
              <span class="mode-badge">{MODE_LABELS[c.mode] ?? c.mode}</span>
              <span class:active={c.status === 'active'} class="status-badge">{c.status === 'active' ? 'In progress' : 'Completed'}</span>
              <span class="date">{new Date(c.createdAt).toLocaleDateString()}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .play-panel { display: flex; flex-direction: column; gap: 2rem; }
  .section h2 { font-size: 1rem; margin: 0 0 0.8rem 0; }
  .section-heading { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.8rem; }
  .section-heading h2 { margin: 0; }
  .ai-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .ai-gate { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.75rem 0.9rem; margin-bottom: 0.8rem; border: 1px solid var(--warn); border-radius: var(--radius-md); background: var(--warn-soft); color: var(--warn-ink); font-size: 0.85rem; }
  .placeholder { color: var(--muted); font-size: 0.9rem; }

  .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr)); gap: 0.8rem; }
  .model-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .model-card:hover { border-color: var(--accent); }
  .model-card.secondary { opacity: 0.85; }
  .model-link { display: flex; flex-direction: column; gap: 0.4rem; text-decoration: none; color: var(--text); }
  .model-link.disabled { color: var(--muted); cursor: not-allowed; }
  .kc-type { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); }
  .kc-name { font-size: 0.95rem; font-weight: 550; }
  .understand-link { align-self: flex-start; font-size: 0.78rem; font-weight: 550; color: var(--accent); text-decoration: none; }
  .understand-link:hover { text-decoration: underline; }

  .convo-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .convo-row {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    text-decoration: none;
    color: var(--text);
  }
  .convo-row:hover { border-color: var(--accent); }
  .convo-row .kc-name { flex: 1; font-weight: 450; }
  .mode-badge { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.1rem 0.4rem; }
  .status-badge { font-size: 0.68rem; color: var(--muted); }
  .status-badge.active { color: var(--accent); font-weight: 600; }
  .date { font-size: 0.78rem; color: var(--muted); }
</style>
