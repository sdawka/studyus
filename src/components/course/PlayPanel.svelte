<script lang="ts">
  type Kc = { id: string; name: string; kcType: string; mastery: number | null };
  type Conversation = { id: string; kcId: string; kcName: string; mode: string; createdAt: number };

  interface Props {
    courseSlug: string;
    principleKcs: Kc[];
    conceptKcs: Kc[];
    conversations: Conversation[];
  }
  const { courseSlug, principleKcs, conceptKcs, conversations }: Props = $props();

  const MODE_LABELS: Record<string, string> = {
    recall: 'Recall',
    classify: 'Classify',
    worked_example: 'Worked example',
    self_explain: 'Self-explain',
    interactive_model: 'Interactive model',
  };
</script>

<div class="play-panel">
  <section class="section">
    <h2>Models &amp; deep dives</h2>
    {#if principleKcs.length === 0 && conceptKcs.length === 0}
      <p class="placeholder">No principles or concepts to explore yet.</p>
    {:else}
      <div class="card-grid">
        {#each principleKcs as kc (kc.id)}
          <a class="model-card" href={`/tutor/${kc.id}`}>
            <span class="kc-type">Principle</span>
            <span class="kc-name">{kc.name}</span>
          </a>
        {/each}
        {#each conceptKcs as kc (kc.id)}
          <a class="model-card secondary" href={`/tutor/${kc.id}`}>
            <span class="kc-type">Concept</span>
            <span class="kc-name">{kc.name}</span>
          </a>
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
            <a class="convo-row" href={`/tutor/${c.kcId}`}>
              <span class="kc-name">{c.kcName}</span>
              <span class="mode-badge">{MODE_LABELS[c.mode] ?? c.mode}</span>
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
  .placeholder { color: var(--muted); font-size: 0.9rem; }

  .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.8rem; }
  .model-card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    text-decoration: none;
    color: var(--text);
    background: var(--surface);
  }
  .model-card:hover { border-color: var(--accent); }
  .model-card.secondary { opacity: 0.85; }
  .kc-type { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); }
  .kc-name { font-size: 0.95rem; font-weight: 550; }

  .convo-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .convo-row {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.55rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    text-decoration: none;
    color: var(--text);
  }
  .convo-row:hover { border-color: var(--accent); }
  .convo-row .kc-name { flex: 1; font-weight: 450; }
  .mode-badge { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); border: 1px solid var(--border); border-radius: 6px; padding: 0.1rem 0.4rem; }
  .date { font-size: 0.78rem; color: var(--muted); }
</style>
