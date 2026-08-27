import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hydrateRuntimeConversation,
  learnerRuntimeError,
  learnerRuntimeSnapshot,
  learnerRuntimeStatus,
  refetchRuntimeConversation,
  refreshLearnerRuntime,
  runtimeConversationsById,
  type RuntimeConversation,
} from '../src/lib/stores/learnerRuntime';

function conversation(overrides: Partial<RuntimeConversation> = {}): RuntimeConversation {
  return {
    id: 'conversation-1',
    kc_id: 'kc-1',
    mode: 'recall',
    details: {},
    status: 'active',
    active_turn_id: null,
    created_at: '2026-08-27T12:00:00.000Z',
    ended_at: null,
    messages: [],
    ...overrides,
  };
}

beforeEach(() => {
  runtimeConversationsById.set({});
  learnerRuntimeSnapshot.set(null);
  learnerRuntimeStatus.set('idle');
  learnerRuntimeError.set(null);
});

afterEach(() => vi.unstubAllGlobals());

describe('learner runtime nanostore projection', () => {
  it('replaces optimistic messages with the DO-returned durable transcript', async () => {
    hydrateRuntimeConversation(
      conversation({
        messages: [{
          id: 'pending-user:1',
          conversation_id: 'conversation-1',
          role: 'user',
          content: 'Hello',
          created_at: '2026-08-27T12:00:01.000Z',
        }],
      }),
    );
    const durable = conversation({
      messages: [
        { id: 'durable-user', conversation_id: 'conversation-1', role: 'user', content: 'Hello', created_at: '2026-08-27T12:00:01.000Z' },
        { id: 'durable-assistant', conversation_id: 'conversation-1', role: 'assistant', content: 'Hi', created_at: '2026-08-27T12:00:02.000Z' },
      ],
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: durable }), { status: 200 })));

    await expect(refetchRuntimeConversation('conversation-1')).resolves.toEqual(durable);
    expect(runtimeConversationsById.get()['conversation-1']).toEqual(durable);
    expect(runtimeConversationsById.get()['conversation-1'].messages.map((message) => message.id)).toEqual([
      'durable-user',
      'durable-assistant',
    ]);
  });

  it('marks a locally active conversation ended when the complete snapshot no longer lists it', async () => {
    hydrateRuntimeConversation(conversation());
    const snapshot = { active_conversations: [], sessions: [], next_alarm_at: null };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: snapshot }), { status: 200 })));

    await expect(refreshLearnerRuntime()).resolves.toEqual(snapshot);
    expect(runtimeConversationsById.get()['conversation-1']).toMatchObject({ status: 'ended', active_turn_id: null });
    expect(learnerRuntimeStatus.get()).toBe('ready');
    expect(learnerRuntimeError.get()).toBeNull();
  });

  it('keeps the last known record and exposes an error when revalidation fails', async () => {
    const known = conversation();
    hydrateRuntimeConversation(known);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'runtime unavailable' } }), { status: 503 })),
    );

    await expect(refetchRuntimeConversation(known.id)).resolves.toBeNull();
    expect(runtimeConversationsById.get()[known.id]).toEqual(known);
    expect(learnerRuntimeStatus.get()).toBe('error');
    expect(learnerRuntimeError.get()).toBe('runtime unavailable');
  });
});
