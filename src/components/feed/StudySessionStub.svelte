<script lang="ts">
</script>

<div class="study-session-stub">
  <div class="stub-header">
    <h3>Study Session Organizer</h3>
    <span class="groups-badge">Shared groups</span>
  </div>

  <p class="stub-description">
    Plan shared sessions, invite your group, and keep the session details together.
  </p>

  <a class="cta-button" href="/groups">Open study groups <span aria-hidden="true">→</span></a>

  <p class="stub-note">
    For solo sessions, use the <a href="/study">study flow</a>.
  </p>
</div>

<style>
  .study-session-stub {
    background: linear-gradient(135deg, color-mix(in oklch, var(--accent-soft) 80%, var(--surface)), color-mix(in oklch, var(--accent-soft) 50%, var(--surface)));
    border: 2px dashed var(--accent);
    border-radius: var(--radius-md);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .stub-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .stub-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--text);
  }

  .groups-badge {
    background: var(--accent);
    color: var(--surface);
    padding: 0.25rem 0.75rem;
    border-radius: var(--radius-md);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stub-description {
    margin: 0;
    color: var(--text);
    font-size: 0.95rem;
    line-height: 1.5;
  }

  .cta-button {
    align-self: flex-start;
    background: var(--accent);
    color: var(--surface);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    padding: 0.6rem 0.85rem;
    font-size: 0.95rem;
    font-weight: 500;
    text-decoration: none;
  }

  .cta-button:hover {
    filter: brightness(0.96);
  }

  .cta-button:focus-visible,
  .stub-note a:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .stub-note {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
    font-style: italic;
  }

  .stub-note a {
    color: var(--accent);
  }
</style>
