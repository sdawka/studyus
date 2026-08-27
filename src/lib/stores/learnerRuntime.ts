// Browser projection of the authenticated learner Durable Object. The DO is
// always authoritative: this module only hydrates server-returned records,
// coordinates islands on the current page, and revalidates after mutations or
// when a hidden page becomes active again. It never persists runtime state in
// localStorage and never invents durable ids.
import { atom, map } from 'nanostores';
import { apiFetch } from '../apiClient';

export interface RuntimeMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface RuntimeConversationSummary {
  id: string;
  kc_id: string | null;
  mode: string;
  details: unknown;
  status: 'active' | 'ended';
  active_turn_id: string | null;
  created_at: string;
  ended_at: string | null;
}

export interface RuntimeConversation extends RuntimeConversationSummary {
  messages: RuntimeMessage[];
}

export interface RuntimeSessionState {
  key: string;
  value: unknown;
  version: number;
  updated_at: string;
}

export interface LearnerRuntimeSnapshot {
  active_conversations: RuntimeConversationSummary[];
  sessions: RuntimeSessionState[];
  next_alarm_at: string | null;
}

export type RuntimeStatus = 'idle' | 'loading' | 'ready' | 'error';

export const learnerRuntimeSnapshot = atom<LearnerRuntimeSnapshot | null>(null);
export const runtimeConversationsById = map<Record<string, RuntimeConversation>>({});
export const learnerRuntimeStatus = atom<RuntimeStatus>('idle');
export const learnerRuntimeError = atom<string | null>(null);

function setError(message: string): void {
  learnerRuntimeError.set(message);
  learnerRuntimeStatus.set('error');
}

export function hydrateRuntimeConversation(conversation: RuntimeConversation): void {
  runtimeConversationsById.setKey(conversation.id, conversation);
  learnerRuntimeError.set(null);
}

export function updateRuntimeConversation(
  id: string,
  update: (conversation: RuntimeConversation) => RuntimeConversation,
): void {
  const current = runtimeConversationsById.get()[id];
  if (current) runtimeConversationsById.setKey(id, update(current));
}

export async function refetchRuntimeConversation(id: string): Promise<RuntimeConversation | null> {
  const result = await apiFetch<RuntimeConversation>(
    `/api/v1/tutor/conversations/${id}`,
    {},
    'Could not refresh the tutor session.',
  );
  if (!result.ok) {
    setError(result.error);
    return null;
  }
  hydrateRuntimeConversation(result.data);
  learnerRuntimeStatus.set('ready');
  return result.data;
}

let snapshotPromise: Promise<LearnerRuntimeSnapshot | null> | null = null;

export function refreshLearnerRuntime(): Promise<LearnerRuntimeSnapshot | null> {
  if (snapshotPromise) return snapshotPromise;
  learnerRuntimeStatus.set('loading');
  snapshotPromise = (async () => {
    try {
      const result = await apiFetch<LearnerRuntimeSnapshot>(
        '/api/v1/runtime/snapshot',
        {},
        'Could not refresh your active study sessions.',
      );
      if (!result.ok) {
        setError(result.error);
        return null;
      }

      learnerRuntimeSnapshot.set(result.data);
      // A snapshot contains every active conversation. If a locally-known
      // conversation was active and disappears, mark it ended immediately;
      // a focused chat also performs a full GET below to obtain ended_at and
      // the final durable transcript.
      const activeIds = new Set(result.data.active_conversations.map((conversation) => conversation.id));
      for (const [id, conversation] of Object.entries(runtimeConversationsById.get())) {
        if (conversation.status === 'active' && !activeIds.has(id)) {
          runtimeConversationsById.setKey(id, { ...conversation, status: 'ended', active_turn_id: null });
        }
      }
      learnerRuntimeError.set(null);
      learnerRuntimeStatus.set('ready');
      return result.data;
    } finally {
      snapshotPromise = null;
    }
  })();
  return snapshotPromise;
}

/**
 * Revalidate after returning to a tab/page. Nanostores coordinates the local
 * page only; focus revalidation is what picks up writes from another browser
 * tab or a future authenticated channel adapter.
 */
export function startLearnerRuntimeSync(conversationId?: string): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const refresh = () => {
    void refreshLearnerRuntime();
    if (conversationId) void refetchRuntimeConversation(conversationId);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', onVisibility);
  void refreshLearnerRuntime();

  return () => {
    window.removeEventListener('pageshow', refresh);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
