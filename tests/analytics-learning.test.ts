import { describe, expect, it } from 'vitest';
import type { BehavioralEventInput } from '../src/lib/analytics/events';
import {
  createAbsorbAnalytics,
  createMisconceptionCardAnalytics,
  createPracticeAnalytics,
  createQuizAnalytics,
  installPageExitAbandonment,
  wholeDaysSince,
} from '../src/lib/analytics/learning';

describe('practice analytics lifecycle', () => {
  it('starts once, carries the latest stage into abandonment, and suppresses it after a terminal', () => {
    const captured: BehavioralEventInput[] = [];
    let now = 10_000;
    const analytics = createPracticeAnalytics((event) => captured.push(event), () => now);

    analytics.start({ course_id: 'course-1', intended_event_type: 'practice_done', ritual_id: 'ritual-1' });
    analytics.start({ course_id: 'course-1', intended_event_type: 'practice_done' });
    analytics.enterStage('reflection');
    now = 12_345;
    analytics.abandon();
    analytics.abandon();

    analytics.start({ course_id: 'course-1', intended_event_type: 'reading_done' });
    analytics.terminal();
    analytics.abandon();

    expect(captured).toEqual([
      {
        name: 'practice_started',
        course_id: 'course-1',
        intended_event_type: 'practice_done',
        ritual_id: 'ritual-1',
      },
      { name: 'practice_abandoned', elapsed_ms: 2_345, stage: 'reflection' },
      { name: 'practice_started', course_id: 'course-1', intended_event_type: 'reading_done' },
    ]);
  });

  it('handles pagehide plus component cleanup without duplicate abandonment', () => {
    const captured: BehavioralEventInput[] = [];
    const analytics = createPracticeAnalytics((event) => captured.push(event), () => 2_000);
    const target = new EventTarget();
    analytics.start({ course_id: 'course-1', intended_event_type: 'video_watched', started_at: 1_000 });

    const cleanup = installPageExitAbandonment(
      analytics.abandon,
      target as Pick<Window, 'addEventListener' | 'removeEventListener'>,
    );
    target.dispatchEvent(new Event('pagehide'));
    cleanup();

    expect(captured.at(-1)).toEqual({ name: 'practice_abandoned', elapsed_ms: 1_000, stage: 'practice' });
    expect(captured.filter((event) => event.name === 'practice_abandoned')).toHaveLength(1);
  });

  it('records one successful explicit discard even before a resumed visit becomes active', () => {
    const captured: BehavioralEventInput[] = [];
    const analytics = createPracticeAnalytics((event) => captured.push(event), () => 12_500);

    analytics.abandonOnDiscard(10_000);
    analytics.abandonOnDiscard(10_000);

    expect(captured).toEqual([
      { name: 'practice_abandoned', elapsed_ms: 2_500, stage: 'setup' },
    ]);
  });
});

describe('quiz analytics lifecycle', () => {
  it('deduplicates KC ids, records only counts, and abandons once before completion', () => {
    const captured: BehavioralEventInput[] = [];
    const analytics = createQuizAnalytics((event) => captured.push(event));

    analytics.start(['kc-1', 'kc-1', 'kc-2'], 3);
    analytics.start(['kc-3'], 1);
    analytics.abandon(2);
    analytics.abandon(3);
    analytics.start(['kc-3'], 1);
    analytics.terminal();
    analytics.abandon(1);

    expect(captured).toEqual([
      { name: 'quiz_started', kc_ids: ['kc-1', 'kc-2'], question_count: 3 },
      { name: 'quiz_abandoned', kc_ids: ['kc-1', 'kc-2'], answered_count: 2 },
      { name: 'quiz_started', kc_ids: ['kc-3'], question_count: 1 },
    ]);
  });
});

describe('absorb and misconception ordering', () => {
  it('keeps absorb stages monotonic and stage one ahead of a gate decision', () => {
    const captured: BehavioralEventInput[] = [];
    const analytics = createAbsorbAnalytics('kc-1', (event) => captured.push(event));

    analytics.decided('verify', 2);
    analytics.decided('verify', 2);
    analytics.reached(2);
    analytics.reached(1);
    analytics.reached(3);
    analytics.reached(4);

    expect(captured.map((event) => event.name)).toEqual([
      'absorb_stage_reached',
      'prereq_gate_decided',
      'absorb_stage_reached',
      'absorb_stage_reached',
      'absorb_stage_reached',
    ]);
    expect(captured[0]).toEqual({ name: 'absorb_stage_reached', kc_id: 'kc-1', stage: 1 });
    expect(captured[1]).toEqual({ name: 'prereq_gate_decided', kc_id: 'kc-1', choice: 'verify', weak_count: 2 });
  });

  it('guarantees a same-card impression before one accepted or dismissed terminal', () => {
    const captured: BehavioralEventInput[] = [];
    const analytics = createMisconceptionCardAnalytics('conversation-1', (event) => captured.push(event));

    analytics.accepted('message-1', 'misconception-1');
    analytics.accepted('message-1', 'misconception-1');
    analytics.shown('message-2', 'misconception-2');
    analytics.shown('message-2', 'misconception-2');
    analytics.dismissed('message-2', 'misconception-2');

    expect(captured).toEqual([
      {
        name: 'misconception_card_shown',
        misconception_id: 'misconception-1',
        conversation_id: 'conversation-1',
      },
      { name: 'misconception_accepted', misconception_id: 'misconception-1' },
      {
        name: 'misconception_card_shown',
        misconception_id: 'misconception-2',
        conversation_id: 'conversation-1',
      },
      { name: 'misconception_dismissed', misconception_id: 'misconception-2' },
    ]);
  });
});

describe('correction timing', () => {
  it('returns a bounded whole-day count without exposing the accepted timestamp', () => {
    expect(wholeDaysSince('2026-08-25T12:00:00.000Z', Date.parse('2026-08-28T11:59:59.999Z'))).toBe(2);
    expect(wholeDaysSince('not-a-date', Date.now())).toBe(0);
  });
});
