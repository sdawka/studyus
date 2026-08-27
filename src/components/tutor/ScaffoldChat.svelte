<script lang="ts">
  import { onMount } from 'svelte';
  import { extractModelSpec } from '../../lib/services/tutor/modelSpec';
  import { extractCorrectionProposal, type CorrectionProposal } from '../../lib/services/tutor/correctionSpec';
  import { apiFetch } from '../../lib/apiClient';
  import {
    hydrateRuntimeConversation,
    refetchRuntimeConversation,
    refreshLearnerRuntime,
    runtimeConversationsById,
    startLearnerRuntimeSync,
    updateRuntimeConversation,
    type RuntimeConversation,
    type RuntimeConversationSummary,
    type RuntimeMessage,
  } from '../../lib/stores/learnerRuntime';
  import { pushToast } from '../../lib/stores/toast';
  import InteractiveModel from './InteractiveModel.svelte';

  type CorrectionState = 'pending' | 'saving' | 'accepted' | 'dismissed';

  let {
    initialConversation,
    kcId,
    aiEnabled,
    aiUnavailableReason,
  }: {
    initialConversation: RuntimeConversation;
    kcId?: string;
    aiEnabled: boolean;
    aiUnavailableReason: 'disabled' | 'provider_not_configured' | null;
  } = $props();

  const conversationId = initialConversation.id;
  // Svelte components also execute during Astro SSR. Only hydrate the shared
  // module store in the browser so one request can never leak runtime state
  // into another user's server render.
  if (typeof window !== 'undefined') hydrateRuntimeConversation(initialConversation);
  let conversation = $derived($runtimeConversationsById[conversationId] ?? initialConversation);
  let messages = $derived(conversation.messages);
  let ended = $derived(conversation.status === 'ended');
  let draft = $state('');
  let sending = $state(false);
  let error = $state<string | null>(null);
  let latestModelSpec = $derived.by(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role !== 'assistant') continue;
      const spec = extractModelSpec(messages[index].content);
      if (spec) return spec;
    }
    return null;
  });

  // Both artifacts are derived from the DO transcript so reloading/resuming a
  // conversation restores the same model and correction cards. Only the
  // learner's transient accept/dismiss interaction remains component-local.
  let correctionProposals = $derived.by(() => {
    const proposals: Record<string, CorrectionProposal> = {};
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      const proposal = extractCorrectionProposal(message.content);
      if (proposal) proposals[message.id] = proposal;
    }
    return proposals;
  });
  let correctionState = $state<Record<string, CorrectionState>>({});

  // Lazily fetched + cached for the life of this component: only needed when
  // a proposal actually carries a misconception_slug to resolve.
  let misconceptionsCache: { id: string; slug: string }[] | null = null;

  onMount(() => startLearnerRuntimeSync(conversationId));

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
    if (!aiEnabled || !content || sending) return;
    error = null;
    draft = '';
    sending = true;

    const now = new Date().toISOString();
    const userMsg: RuntimeMessage = { id: `pending-user:${crypto.randomUUID()}`, conversation_id: conversationId, role: 'user', content, created_at: now };
    const assistantMsg: RuntimeMessage = { id: `pending-assistant:${crypto.randomUUID()}`, conversation_id: conversationId, role: 'assistant', content: '', created_at: now };
    updateRuntimeConversation(conversationId, (current) => ({ ...current, messages: [...current.messages, userMsg, assistantMsg] }));

    try {
      const res = await fetch(`/api/v1/tutor/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => null);
        error = json?.error?.message ?? 'The tutor is unavailable right now.';
        // The request may have reached the DO before the response failed.
        // Replace the optimistic pair with whatever was durably committed.
        await refetchRuntimeConversation(conversationId);
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
              updateRuntimeConversation(conversationId, (current) => ({
                ...current,
                messages: current.messages.map((message) =>
                  message.id === assistantMsg.id ? { ...message, content: textSoFar } : message,
                ),
              }));
            }
          } catch {
            // ignore malformed/partial frame
          }
        }
      }

      // The SSE closes only after the DO has finalized the durable assistant
      // message and any cap-driven status transition. Re-read that record so
      // temporary ids and optimistic content never become the lasting UI.
      const authoritative = await refetchRuntimeConversation(conversationId);
      void refreshLearnerRuntime();

      const proposal = extractCorrectionProposal(fullText);
      if (proposal) {
        const durableAssistantId = authoritative?.messages.findLast((message) => message.role === 'assistant')?.id ?? assistantMsg.id;
        correctionState = { ...correctionState, [durableAssistantId]: 'pending' };
      }
    } catch {
      error = 'Connection to the tutor was interrupted.';
      await refetchRuntimeConversation(conversationId);
      void refreshLearnerRuntime();
    } finally {
      sending = false;
    }
  }

  async function endSession() {
    if (sending) return;
    error = null;
    const result = await apiFetch<{ conversation: RuntimeConversationSummary }>(
      `/api/v1/tutor/conversations/${conversationId}/end`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      'Could not end this tutor session.',
    );
    if (!result.ok) {
      error = result.error;
      pushToast(result.error, 'error');
      await refetchRuntimeConversation(conversationId);
      return;
    }
    updateRuntimeConversation(conversationId, (current) => ({ ...current, ...result.data.conversation }));
    await refetchRuntimeConversation(conversationId);
    void refreshLearnerRuntime();
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
  {:else if !aiEnabled}
    <div class="ai-gate" role="status" data-ai-feature="tutor">
      <strong>AI replies unavailable</strong>
      <span>{aiUnavailableReason === 'provider_not_configured' ? 'OpenRouter is not configured for this environment.' : 'AI tutoring is disabled in this environment.'}</span>
      <button type="button" class="end-btn" onclick={endSession}>End session</button>
    </div>
  {:else}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <input type="text" bind:value={draft} placeholder="Type your answer or question…" disabled={sending} />
      <button type="submit" disabled={sending || !draft.trim()}>{sending ? 'Thinking…' : 'Send'}</button>
      <button type="button" class="end-btn" disabled={sending} onclick={endSession}>End session</button>
    </form>
  {/if}
</div>

<style>
  .tutor-chat { display: flex; flex-direction: column; gap: 1rem; max-width: 640px; }
  .messages { display: flex; flex-direction: column; gap: 0.75rem; min-height: 200px; }
  .bubble { padding: 0.65rem 0.9rem; border-radius: var(--radius-md); max-width: 85%; white-space: pre-wrap; }
  .bubble p { margin: 0; }
  .bubble.user { align-self: flex-end; background: var(--accent); color: var(--surface); }
  .bubble.assistant { align-self: flex-start; background: var(--hover); color: var(--text); }
  .empty { color: var(--muted); font-size: 0.9rem; }
  form { display: flex; gap: 0.5rem; }
  input {
    flex: 1;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 1rem;
  }
  button { padding: 0.6rem 0.9rem; border-radius: var(--radius-sm); border: none; cursor: pointer; font-size: 0.9rem; }
  button[type='submit'] { background: var(--accent); color: var(--surface); }
  button:disabled { opacity: 0.6; cursor: default; }
  .end-btn { background: var(--border); color: var(--text); }
  .error { color: var(--danger); font-size: 0.85rem; }
  .ended { color: var(--good); font-size: 0.9rem; }
  .ai-gate { display: flex; flex-direction: column; align-items: flex-start; gap: 0.4rem; padding: 0.8rem 0.9rem; border: 1px solid var(--warn); border-radius: var(--radius-md); background: var(--warn-soft); color: var(--warn-ink); font-size: 0.85rem; }

  .correction-card {
    align-self: flex-start;
    max-width: 85%;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.75rem 0.9rem;
    border-radius: var(--radius-md);
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
