import type { NextMove, AvailableMinutes } from '../schemas/nextMove';
import type { AnalyticsSession } from './session';
import type { BehavioralEventInput } from './events';

export type BehavioralCapture = (event: BehavioralEventInput) => void;

/** The daily-loop entry ordering is protocol, not a component side effect. */
export function capturePageLifecycle(
  current: AnalyticsSession,
  surface: string,
  capture: BehavioralCapture,
): void {
  if (current.is_new_session) {
    capture({
      name: 'app_session_started',
      entry_route: surface,
      ...(current.days_since_last_session === undefined ? {} : { days_since_last_session: current.days_since_last_session }),
    });
  }
  capture({
    name: 'page_viewed',
    route: surface,
    ...(current.previous_surface ? { referrer_route: current.previous_surface } : {}),
  });
}

type Recommendation = Pick<NextMove, 'action_id' | 'kind'>;

/**
 * Keeps the impression denominator ahead of every Next Move terminal action.
 * The visible key suppresses framework rerenders while still recording a move
 * shown again after a rotation or budget change.
 */
export function createNextMoveAnalytics(capture: BehavioralCapture) {
  let visibleInteraction: { key: string; terminal: boolean } | undefined;

  function viewed(move: Recommendation, rank: number, availableMinutes: AvailableMinutes): void {
    const key = `${move.action_id}:${rank}:${availableMinutes}`;
    if (visibleInteraction?.key === key) return;
    capture({
      name: 'next_move_viewed',
      recommendation_id: move.action_id,
      rank,
      kind: move.kind,
      available_minutes: availableMinutes,
    });
    visibleInteraction = { key, terminal: false };
  }

  function terminal(
    name: 'recommendation_followed' | 'recommendation_ignored',
    move: Recommendation,
    rank: number,
    availableMinutes: AvailableMinutes,
  ): void {
    viewed(move, rank, availableMinutes);
    if (visibleInteraction?.terminal) return;
    capture({ name, recommendation_id: move.action_id, rank });
    if (visibleInteraction) visibleInteraction.terminal = true;
  }

  return {
    viewed,
    followed: (move: Recommendation, rank: number, availableMinutes: AvailableMinutes) =>
      terminal('recommendation_followed', move, rank, availableMinutes),
    ignored: (move: Recommendation, rank: number, availableMinutes: AvailableMinutes) =>
      terminal('recommendation_ignored', move, rank, availableMinutes),
  };
}
