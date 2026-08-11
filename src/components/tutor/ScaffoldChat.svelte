<script lang="ts">
  import { extractModelSpec, type ModelSpec } from '../../lib/services/tutor/modelSpec';
  import InteractiveModel from './InteractiveModel.svelte';

  type Message = { id: string; role: 'user' | 'assistant'; content: string };

  let {
    conversationId,
    initialMessages = [],
  }: { conversationId: string; mode?: string; initialMessages?: Message[] } = $props();

  let messages = $state<Message[]>(initialMessages);
  let draft = $state('');
  let sending = $state(false);
  let error = $state<string | null>(null);
  let latestModelSpec = $state<ModelSpec | null>(null);
  let ended = $state(false);

  function stripFences(text: string): string {
    return text.replace(/```json[\s\S]*?```/i, '').trim();
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
  .bubble.user { align-self: flex-end; background: var(--accent, #3f6fd8); color: white; }
  .bubble.assistant { align-self: flex-start; background: #f0f2f5; color: #1c1e21; }
  .empty { color: #6b7280; font-size: 0.9rem; }
  form { display: flex; gap: 0.5rem; }
  input {
    flex: 1;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    font-size: 1rem;
  }
  button { padding: 0.6rem 0.9rem; border-radius: 8px; border: none; cursor: pointer; font-size: 0.9rem; }
  button[type='submit'] { background: var(--accent, #3f6fd8); color: white; }
  button:disabled { opacity: 0.6; cursor: default; }
  .end-btn { background: #e5e7eb; color: #374151; }
  .error { color: #b91c1c; font-size: 0.85rem; }
  .ended { color: #059669; font-size: 0.9rem; }
</style>
