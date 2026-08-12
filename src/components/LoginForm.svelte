<script lang="ts">
  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(null);
  let submitting = $state(false);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    submitting = true;
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        error = json?.error?.message ?? 'Login failed';
        return;
      }
      window.location.href = '/dashboard';
    } catch (err) {
      error = 'Network error, please try again.';
    } finally {
      submitting = false;
    }
  }
</script>

<form onsubmit={handleSubmit}>
  <label>
    Email
    <input type="email" bind:value={email} required autocomplete="email" />
  </label>
  <label>
    Password
    <input type="password" bind:value={password} required autocomplete="current-password" />
  </label>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  <button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 320px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
    color: var(--text);
  }
  input {
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 1rem;
  }
  button {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0.65rem;
    font-size: 1rem;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .error { color: var(--danger); font-size: 0.85rem; margin: 0; }
</style>
