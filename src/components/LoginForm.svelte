<script lang="ts">
  import { apiFetch } from '../lib/apiClient';

  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(null);
  let submitting = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    submitting = true;
    try {
      const result = await apiFetch(
        '/api/v1/auth/login',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) },
        'Login failed',
      );
      if (!result.ok) {
        error = result.error;
        return;
      }
      window.location.href = '/dashboard';
    } finally {
      submitting = false;
    }
  }
</script>

<form onsubmit={handleSubmit}>
  <label>
    Email
    <input type="email" bind:value={email} required autocomplete="email" placeholder="you@school.edu" />
  </label>
  <label>
    Password
    <input type="password" bind:value={password} required autocomplete="current-password" placeholder="••••••••" />
  </label>
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 0.84rem;
    font-weight: var(--weight-semi);
    color: var(--muted);
  }
  input {
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.98rem;
    transition: border-color var(--motion-base) var(--ease), box-shadow var(--motion-base) var(--ease);
  }
  input::placeholder { color: var(--faint); }
  input:hover { border-color: var(--muted); }
  input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  button {
    margin-top: 0.3rem;
    background: var(--accent);
    color: var(--accent-contrast, var(--surface));
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    font-size: 0.98rem;
    font-weight: var(--weight-semi);
    cursor: pointer;
    box-shadow: var(--accent-glow, none);
    transition: transform var(--motion-fast) var(--ease-bounce, var(--ease)), filter var(--motion-base) var(--ease), box-shadow var(--motion-base) var(--ease);
  }
  button:hover:not(:disabled) { filter: brightness(0.96); transform: translateY(-1px); }
  button:active:not(:disabled) { transform: translateY(1px); }
  button:disabled { opacity: 0.55; cursor: default; box-shadow: none; }
  .error {
    color: var(--danger-ink);
    background: var(--danger-soft);
    border-radius: var(--radius-sm);
    padding: 0.55rem 0.75rem;
    font-size: 0.85rem;
    margin: -0.3rem 0 0;
  }
</style>
