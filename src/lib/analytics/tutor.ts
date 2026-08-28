import type { TutorMode } from '../schemas/tutor';
import type { LearningCapture } from './learning';

export const TUTOR_ENTRIES = ['direct', 'next_move', 'absorb', 'course'] as const;
export type TutorEntry = (typeof TUTOR_ENTRIES)[number];

/** Component-local lifecycle guard: a mounted conversation produces one open. */
export function createTutorOpenedAnalytics(capture: LearningCapture) {
  let openedConversationId: string | undefined;

  return {
    opened(conversationId: string, mode: TutorMode, kcId: string, entry: TutorEntry): void {
      if (openedConversationId === conversationId) return;
      openedConversationId = conversationId;
      capture({ name: 'tutor_opened', conversation_id: conversationId, mode, kc_id: kcId, entry });
    },
  };
}

export function tutorSurfaceForEntry(entry: TutorEntry): '/learn/[kcId]' | '/tutor/[kcId]' {
  return entry === 'absorb' || entry === 'next_move' ? '/learn/[kcId]' : '/tutor/[kcId]';
}
