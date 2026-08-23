<script lang="ts">
</script>

<div class="study-session-stub">
  <div class="stub-header">
    <h3>Study Session Organizer</h3>
    <span class="coming-soon-badge">Coming soon</span>
  </div>

  <p class="stub-description">
    Organize and schedule collaborative study sessions with other students in your courses. Share notes, solve problems together, and reinforce learning as a group.
  </p>

  <form class="stub-form" disabled>
    <div class="form-group">
      <label for="stub-course">Select a course</label>
      <select id="stub-course" disabled>
        <option>Choose a course...</option>
      </select>
    </div>

    <div class="form-group">
      <label for="stub-date">Proposed date & time</label>
      <input id="stub-date" type="datetime-local" disabled />
    </div>

    <div class="form-group">
      <label for="stub-duration">Duration (minutes)</label>
      <input id="stub-duration" type="number" min="15" max="180" placeholder="30" disabled />
    </div>

    <button type="button" disabled class="cta-button">Schedule session</button>
  </form>

  <p class="stub-note">
    Multi-user collaboration features are being developed. In the meantime, use the /study flow to log your solo study sessions.
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

  .coming-soon-badge {
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

  .stub-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    opacity: 0.6;
    pointer-events: none;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .form-group label {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--muted);
  }

  .form-group input,
  .form-group select {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
  }

  .cta-button {
    background: var(--accent);
    color: var(--surface);
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.6rem;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: not-allowed;
    opacity: 0.5;
  }

  .stub-note {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
    font-style: italic;
  }
</style>
