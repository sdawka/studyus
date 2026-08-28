import type { EventType } from '../schemas/events';
import type { BehavioralEventInput } from './events';

export type LearningCapture = (event: BehavioralEventInput) => void;
export type PracticeStage = 'setup' | 'practice' | 'reflection';

const MAX_DURATION_MS = 86_400_000;
const MAX_COUNT = 100_000;

function boundedDuration(startedAt: number, now: number): number {
  return Math.min(MAX_DURATION_MS, Math.max(0, Math.floor(now - startedAt)));
}

function boundedCount(value: number): number {
  return Math.min(MAX_COUNT, Math.max(0, Math.floor(value)));
}

export function wholeDaysSince(iso: string, now = Date.now()): number {
  const then = Date.parse(iso);
  return Number.isFinite(then) ? boundedCount((now - then) / 86_400_000) : 0;
}

export function installPageExitAbandonment(
  abandon: () => void,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  target.addEventListener('pagehide', abandon);
  return () => {
    target.removeEventListener('pagehide', abandon);
    abandon();
  };
}

type PracticeStart = {
  course_id: string;
  intended_event_type: EventType;
  ritual_id?: string;
  started_at?: number;
};

export function createPracticeAnalytics(capture: LearningCapture, now: () => number = Date.now) {
  let active: { startedAt: number; stage: PracticeStage } | undefined;
  let inactiveDiscardRecorded = false;

  function captureAbandonment(startedAt: number, stage: PracticeStage): void {
    capture({ name: 'practice_abandoned', elapsed_ms: boundedDuration(startedAt, now()), stage });
  }

  function abandon(): void {
    if (!active) return;
    const current = active;
    active = undefined;
    captureAbandonment(current.startedAt, current.stage);
  }

  return {
    start(input: PracticeStart): void {
      if (active) return;
      inactiveDiscardRecorded = false;
      capture({
        name: 'practice_started',
        course_id: input.course_id,
        intended_event_type: input.intended_event_type,
        ...(input.ritual_id ? { ritual_id: input.ritual_id } : {}),
      });
      active = { startedAt: input.started_at ?? now(), stage: 'practice' };
    },
    enterStage(stage: PracticeStage): void {
      if (active) active.stage = stage;
    },
    terminal(): void {
      active = undefined;
    },
    abandonOnDiscard(visitStartedAt: number): void {
      if (active) {
        abandon();
        return;
      }
      if (inactiveDiscardRecorded) return;
      inactiveDiscardRecorded = true;
      captureAbandonment(visitStartedAt, 'setup');
    },
    abandon,
  };
}

export function createQuizAnalytics(capture: LearningCapture) {
  let active: { kcIds: string[] } | undefined;

  function abandon(answeredCount: number): void {
    if (!active) return;
    const current = active;
    active = undefined;
    capture({ name: 'quiz_abandoned', kc_ids: current.kcIds, answered_count: boundedCount(answeredCount) });
  }

  return {
    start(kcIds: string[], questionCount: number): void {
      if (active || kcIds.length === 0 || questionCount <= 0) return;
      const uniqueKcIds = [...new Set(kcIds)];
      capture({ name: 'quiz_started', kc_ids: uniqueKcIds, question_count: boundedCount(questionCount) });
      active = { kcIds: uniqueKcIds };
    },
    terminal(): void {
      active = undefined;
    },
    abandon,
  };
}

export function createAbsorbAnalytics(kcId: string, capture: LearningCapture) {
  let highestStage = 0;
  const decisions = new Set<string>();

  function reached(stage: 1 | 2 | 3 | 4): void {
    if (stage <= highestStage) return;
    highestStage = stage;
    capture({ name: 'absorb_stage_reached', kc_id: kcId, stage });
  }

  return {
    reached,
    decided(choice: 'verify' | 'continue_anyway', weakCount: number): void {
      reached(1);
      const key = `${choice}:${weakCount}`;
      if (decisions.has(key)) return;
      decisions.add(key);
      capture({ name: 'prereq_gate_decided', kc_id: kcId, choice, weak_count: boundedCount(weakCount) });
    },
  };
}

export function createMisconceptionCardAnalytics(conversationId: string, capture: LearningCapture) {
  const shownCards = new Set<string>();
  const terminalCards = new Set<string>();

  function shown(cardKey: string, misconceptionId: string): void {
    if (shownCards.has(cardKey)) return;
    shownCards.add(cardKey);
    capture({ name: 'misconception_card_shown', misconception_id: misconceptionId, conversation_id: conversationId });
  }

  function terminal(
    name: 'misconception_accepted' | 'misconception_dismissed',
    cardKey: string,
    misconceptionId: string,
  ): void {
    shown(cardKey, misconceptionId);
    if (terminalCards.has(cardKey)) return;
    terminalCards.add(cardKey);
    capture({ name, misconception_id: misconceptionId });
  }

  return {
    shown,
    accepted: (cardKey: string, misconceptionId: string) => terminal('misconception_accepted', cardKey, misconceptionId),
    dismissed: (cardKey: string, misconceptionId: string) => terminal('misconception_dismissed', cardKey, misconceptionId),
  };
}
