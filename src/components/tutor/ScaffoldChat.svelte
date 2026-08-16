<script lang="ts">
  import { extractModelSpec, type ModelSpec } from '../../lib/services/tutor/modelSpec';
  import { extractCorrectionProposal, type CorrectionProposal } from '../../lib/services/tutor/correctionSpec';
  import { apiFetch } from '../../lib/apiClient';
  import { pushToast } from '../../lib/stores/toast';
  import InteractiveModel from './InteractiveModel.svelte';

  type Message = { id: string; role: 'user' | 'assistant'; content: string };
  type CorrectionState = 'pending' | 'saving' | 'accepted' | 'dismissed';

  let {
    conversationId,
    kcId,
    initialMessages = [],
  }: { conversationId: string; mode?: string; kcId?: string; initialMessages?: Message[] } = $props();

  let messages = $state<Message[]>(initialMessages);
  let draft = $state('');
  let sending = $state(false);
  let error = $state<string | null>(null);
  let latestModelSpec = $state<ModelSpec | null>(null);
  let ended = $state(false);

  // Keyed by assistant message id, not a single "latest" like latestModelSpec
  // above — a correction card needs its own persistent accept/dismiss state
  // that a later message (with or without its own proposal) must not clobber.
  let correctionProposals = $state<Record<string, CorrectionProposal>>({});
  let correctionState = $state<Record<string, CorrectionState>>({});

  // Lazily fetched + cached for the life of this component: only needed when
  // a proposal actually carries a misconception_slug to resolve.
  let misconceptionsCache: { id: string; slug: string }[] | null = null;

  function stripFences(text: string): string {
    // Global flag: an absorb-mode turn may carry both an interactive_model
    // block and a correction_proposal block (docs/api.md) — both need to be
    // scrubbed from the displayed prose, not just the first fenced block.
    return text.replace(/```json[\s\S]*?```/gi, '').trim();
  }

  async function resolveMisconceptionId(slug: string): Promise<string | undefined> {
    if (!kcId) return undefined;
    if (!misconceptionsCache) {
      const res = await apiFetch<{ id: string; slug: string }[]>(`/api/v1/kcs/${kcId}/misconceptions`);
      misconceptionsCache = res.ok ? res.data : [];
    }
    return misconceptionsCache.find((m) => m.slug === slug)?.id;
  }

  async function acceptCorrection(messageId: string) {
    const proposal = correctionProposals[messageId];
    if (!proposal) return;
    correctionState = { ...correctionState, [messageId]: 'saving' };

    const misconceptionId = proposal.misconception_slug ? await resolveMisconceptionId(proposal.misconception_slug) : undefined;

    const res = await apiFetch(
      '/api/v1/corrections',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kc_id: kcId,
          misconception_id: misconceptionId,
          prior_belief: proposal.prior_belief,
          correction: proposal.correction,
          source_conversation_id: conversationId,
        }),
      },
      'Could not save that correction right now.',
    );

    if (!res.ok) {
      correctionState = { ...correctionState, [messageId]: 'pending' };
      pushToast(res.error, 'error');
      return;
    }
    correctionState = { ...correctionState, [messageId]: 'accepted' };
    pushToast('Added to your corrections ledger.', 'success');
  }

  function dismissCorrection(messageId: string) {
    correctionState = { ...correctionState, [messageId]: 'dismissed' };
  }

  async function send() {
    const content = draft.trim();
    if (!content || sending) return;
    error = null;
    draft = '';
    sending = true;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content };
    const assistantMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: '' };
    messages = [...messages, userMsg, assistantMsg];

    try {
      const res = await fetch(`/api/v1/tutor/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => null);
        error = json?.error?.message ?? 'The tutor is unavailable right now.';
        messages = messages.filter((m) => m.id !== assistantMsg.id);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          try {
            const parsedFrame = JSON.parse(payload) as { delta?: string };
            if (typeof parsedFrame.delta === 'string') {
              fullText += parsedFrame.delta;
              const textSoFar = fullText;
              messages = messages.map((m) => (m.id === assistantMsg.id ? { ...m, content: textSoFar } : m));
            }
          } catch {
            // ignore malformed/partial frame
          }
        }
      }

      const spec = extractModelSpec(fullText);
      if (spec) latestModelSpec = spec;

      const proposal = extractCorrectionProposal(fullText);
      if (proposal) {
        correctionProposals = { ...correctionProposals, [assistantMsg.id]: proposal };
        correctionState = { ...correctionState, [assistantMsg.id]: 'pending' };
      }
    } catch {
      error = 'Connection to the tutor was interrupted.';
    } finally {
      sending = false;
    }
  }

  async function endSession() {
    await fetch(`/api/v1/tutor/conversations/${conversationId}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    ended = true;
  }
</script>

<div class="tutor-chat">
  <div class="messages">
    {#each messages as m (m.id)}
      <div class="bubble {m.role}">
        <p>{m.role === 'assistant' ? stripFences(m.content) : m.content}</p>
      </div>
      {#if m.role === 'assistant' && correctionProposals[m.id] && correctionState[m.id] !== 'dismissed'}
        {@const proposal = correctionProposals[m.id]}
        {@const cState = correctionState[m.id]}
        <div class="correction-card">
          {#if cState === 'accepted'}
            <p class="correction-flip">✓ In your ledger</p>
          {:else}
            <p class="correction-label">Worth correcting</p>
            <p class="correction-prior"><span class="strike">{proposal.prior_belief}</span></p>
            <p class="correction-new">{proposal.correction}</p>
            <div class="correction-actions">
              <button type="button" class="accept-btn" disabled={cState === 'saving'} onclick={() => acceptCorrection(m.id)}>
                {cState === 'saving' ? 'Saving…' : 'Accept'}
              </button>
              <button type="button" class="dismiss-btn" disabled={cState === 'saving'} onclick={() => dismissCorrection(m.id)}>
                Not now
              </button>
            </div>
          {/if}
        </div>
      {/if}
    {/each}
    {#if messages.length === 0}
      <p class="empty">Say hello to start the session.</p>
    {/if}
  </div>

  {#if latestModelSpec}
    <InteractiveModel spec={latestModelSpec} />
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if ended}
    <p class="ended">Session ended — nice work.</p>
  {:else}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <input type="text" bind:value={draft} placeholder="Type your answer or question…" disabled={sending} />
      <button type="submit" disabled={sending || !draft.trim()}>{sending ? 'Thinking…' : 'Send'}</button>
      <button type="button" class="end-btn" onclick={endSession}>End session</button>
    </form>
  {/if}
</div>

<style>
  .tutor-chat { display: flex; flex-direction: column; gap: 1rem; max-width: 640px; }
  .messages { display: flex; flex-direction: column; gap: 0.75rem; min-height: 200px; }
  .bubble { padding: 0.65rem 0.9rem; border-radius: 10px; max-width: 85%; white-space: pre-wrap; }
  .bubble p { margin: 0; }
  .bubble.user { align-self: flex-end; background: var(--accent); color: var(--surface); }
  .bubble.assistant { align-self: flex-start; background: var(--hover); color: var(--text); }
  .empty { color: var(--muted); font-size: 0.9rem; }
  form { display: flex; gap: 0.5rem; }
  input {
    flex: 1;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 1rem;
  }
  button { padding: 0.6rem 0.9rem; border-radius: 8px; border: none; cursor: pointer; font-size: 0.9rem; }
  button[type='submit'] { background: var(--accent); color: var(--surface); }
  button:disabled { opacity: 0.6; cursor: default; }
  .end-btn { background: var(--border); color: var(--text); }
  .error { color: var(--danger); font-size: 0.85rem; }
  .ended { color: var(--good); font-size: 0.9rem; }

  .correction-card {
    align-self: flex-start;
    max-width: 85%;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.75rem 0.9rem;
    border-radius: 10px;
    border: 1px solid var(--warn);
    background: var(--warn-soft);
  }
  .correction-label { margin: 0; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--warn-ink); }
  .correction-prior { margin: 0; font-size: 0.88rem; color: var(--muted); }
  .strike { text-decoration: line-through; }
  .correction-new { margin: 0; font-size: 0.92rem; font-weight: 550; color: var(--text); }
  .correction-actions { display: flex; gap: 0.5rem; margin-top: 0.2rem; }
  .accept-btn { background: var(--accent); color: var(--surface); padding: 0.4rem 0.8rem; font-size: 0.85rem; }
  .dismiss-btn { background: none; color: var(--muted); padding: 0.4rem 0.8rem; font-size: 0.85rem; }
  .correction-flip { margin: 0; color: var(--good-ink); font-size: 0.9rem; font-weight: 550; }

  /* main content-box ≤ 480px (PHONE): input claims its own full-width row;
     Send/End drop to a second row at a 44px touch target. Bubbles widen
     since 85% leaves an unhelpfully narrow column at this width. */
  @container (max-width: 480px) {
    .bubble { max-width: 92%; }
    form { flex-wrap: wrap; }
    input { flex: 1 1 100%; }
    form button { min-height: 44px; }
  }
</style>
