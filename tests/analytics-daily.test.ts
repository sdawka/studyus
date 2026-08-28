import { describe, expect, it } from 'vitest';
import { capturePageLifecycle, createNextMoveAnalytics } from '../src/lib/analytics/daily';
import { ANALYTICS_IDLE_TIMEOUT_MS, resolveAnalyticsSession } from '../src/lib/analytics/session';
import type { BehavioralEventInput } from '../src/lib/analytics/events';
import type { NextMove } from '../src/lib/schemas/nextMove';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++]!;
}

const moveA = { action_id: 'understand:kc-a:none:25', kind: 'frontier_understand' } as NextMove;
const moveB = { action_id: 'quick_quiz:kc-b:assessment-b:25', kind: 'assessment_practice' } as NextMove;

describe('daily analytics ordering', () => {
  it('emits app_session_started before the first page and omits first-session distance', () => {
    const storage = new MemoryStorage();
    const session = resolveAnalyticsSession(storage, '/dashboard', 1_000, ids('anon-1', 'session-1'));
    const captured: BehavioralEventInput[] = [];

    capturePageLifecycle(session, '/dashboard', (event) => captured.push(event));

    expect(captured).toEqual([
      { name: 'app_session_started', entry_route: '/dashboard' },
      { name: 'page_viewed', route: '/dashboard' },
    ]);
    expect(captured[0]).not.toHaveProperty('days_since_last_session');
  });

  it('emits only page_viewed below 30 minutes and starts a new ordered session after idle', () => {
    const storage = new MemoryStorage();
    resolveAnalyticsSession(storage, '/dashboard', 1_000, ids('anon-1', 'session-1'));
    const within = resolveAnalyticsSession(
      storage,
      '/tasks',
      1_000 + ANALYTICS_IDLE_TIMEOUT_MS - 1,
      ids('unused'),
    );
    const withinEvents: BehavioralEventInput[] = [];
    capturePageLifecycle(within, '/tasks', (event) => withinEvents.push(event));
    expect(withinEvents).toEqual([{ name: 'page_viewed', route: '/tasks', referrer_route: '/dashboard' }]);

    const twoDaysLater = 1_000 + ANALYTICS_IDLE_TIMEOUT_MS - 1 + 2 * 86_400_000;
    const afterIdle = resolveAnalyticsSession(storage, '/dashboard', twoDaysLater, ids('session-2'));
    const afterIdleEvents: BehavioralEventInput[] = [];
    capturePageLifecycle(afterIdle, '/dashboard', (event) => afterIdleEvents.push(event));
    expect(afterIdleEvents).toEqual([
      { name: 'app_session_started', entry_route: '/dashboard', days_since_last_session: 2 },
      { name: 'page_viewed', route: '/dashboard', referrer_route: '/tasks' },
    ]);
  });
});

describe('Next Move analytics ordering', () => {
  it('deduplicates rerenders but emits each rotation and budget response impression', () => {
    const captured: BehavioralEventInput[] = [];
    const analytics = createNextMoveAnalytics((event) => captured.push(event));

    analytics.viewed(moveA, 1, 25);
    analytics.viewed(moveA, 1, 25);
    analytics.ignored(moveA, 1, 25);
    analytics.viewed(moveB, 2, 25);
    analytics.ignored(moveB, 2, 25);
    analytics.viewed(moveA, 1, 25);
    analytics.viewed(moveA, 1, 50);

    expect(captured.map((event) => event.name)).toEqual([
      'next_move_viewed',
      'recommendation_ignored',
      'next_move_viewed',
      'recommendation_ignored',
      'next_move_viewed',
      'next_move_viewed',
    ]);
    expect(captured[2]).toMatchObject({ recommendation_id: moveB.action_id, rank: 2, kind: moveB.kind, available_minutes: 25 });
    expect(captured.at(-1)).toMatchObject({ recommendation_id: moveA.action_id, rank: 1, available_minutes: 50 });
  });

  it('inserts a same-id impression before a primary follow when one is missing', () => {
    const captured: BehavioralEventInput[] = [];
    const analytics = createNextMoveAnalytics((event) => captured.push(event));

    analytics.followed(moveA, 1, 15);

    expect(captured).toEqual([
      {
        name: 'next_move_viewed',
        recommendation_id: moveA.action_id,
        rank: 1,
        kind: moveA.kind,
        available_minutes: 15,
      },
      { name: 'recommendation_followed', recommendation_id: moveA.action_id, rank: 1 },
    ]);
  });

  it('allows one terminal per visible interaction and resets after a rotation away and back', () => {
    const captured: BehavioralEventInput[] = [];
    const analytics = createNextMoveAnalytics((event) => captured.push(event));

    analytics.viewed(moveA, 1, 25);
    analytics.followed(moveA, 1, 25);
    analytics.followed(moveA, 1, 25);
    analytics.ignored(moveA, 1, 25);
    analytics.viewed(moveB, 2, 25);
    analytics.ignored(moveB, 2, 25);
    analytics.viewed(moveA, 1, 25);
    analytics.followed(moveA, 1, 25);

    expect(captured.map((event) => event.name)).toEqual([
      'next_move_viewed',
      'recommendation_followed',
      'next_move_viewed',
      'recommendation_ignored',
      'next_move_viewed',
      'recommendation_followed',
    ]);
  });
});
