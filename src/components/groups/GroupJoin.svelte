<script lang="ts">
  import { apiFetch } from '../../lib/apiClient';

  interface Props { token: string; }
  let { token }: Props = $props();
  let accepting = $state(false);
  let error = $state<string | null>(null);
  let acceptedGroup = $state<{ id?: string; name?: string } | null>(null);

  async function acceptInvitation() {
    if (!token) {
      error = 'This invitation link is missing its token.';
      return;
    }
    accepting = true;
    error = null;
    const result = await apiFetch<{ group_id?: string; group?: { id?: string; name?: string } }>(
      '/api/v1/groups/invitations/accept',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      },
      'Could not accept invitation',
    );
    if (result.ok) {
      const group = result.data.group ?? { id: result.data.group_id };
      acceptedGroup = group;
    } else {
      error = result.error;
    }
    accepting = false;
  }
</script>

<div class="join-card">
  <p class="eyebrow">Invite-only group</p>
  <h1>Join your study group</h1>
  <p class="lede">Accepting this invite requires the verified email address it was sent to. Personal notes, grades, and learning history are never shared.</p>
  {#if error}
    <p class="error" role="alert">{error}</p>
    <p class="hint">Sign in with the matching verified email, then open this link again.</p>
  {:else if acceptedGroup}
    <div class="success" role="status">
      <strong>You joined {acceptedGroup.name ?? 'the group'}.</strong>
      {#if acceptedGroup.id}<a class="button primary" href={`/groups/${acceptedGroup.id}`}>Open group</a>{/if}
    </div>
  {:else}
    <button class="button primary" type="button" onclick={acceptInvitation} disabled={accepting || !token}>
      {accepting ? 'Accepting…' : 'Accept invitation'}
    </button>
  {/if}
</div>

<style>
  .join-card { max-width: 560px; margin: 3rem auto; padding: 1.5rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); display: grid; gap: .75rem; }
  h1, p { margin: 0; }
  .eyebrow { color: var(--accent); font: 650 .72rem/1 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
  .lede, .hint { color: var(--muted); line-height: 1.5; }
  .error { padding: .7rem; border-radius: var(--radius-sm); background: var(--danger-soft); color: var(--danger); font-size: .88rem; }
  .button { border: 1px solid var(--accent); border-radius: var(--radius-sm); padding: .65rem .9rem; text-decoration: none; font: 600 .85rem/1 var(--font-title, var(--font-body)); cursor: pointer; width: fit-content; }
  .primary { background: var(--accent); color: var(--accent-contrast); }
  .button:disabled { opacity: .55; cursor: wait; }
  .success { display: grid; gap: .8rem; padding: .8rem; background: var(--accent-soft); border-radius: var(--radius-sm); }
  @media (max-width: 600px) { .join-card { margin: 1rem auto; } }
</style>
