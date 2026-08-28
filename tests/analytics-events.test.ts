import { describe, expect, it } from 'vitest';
import { behavioralEventNames, behavioralEventSchema, enrichBehavioralEvent } from '../src/lib/analytics/events';

const base = { session_id: 'session-1', surface: '/courses/[slug]', ts: 1_800_000_000_000 };

describe('behavioral event taxonomy', () => {
  it('contains the complete approved vocabulary without duplicate names', () => {
    expect(behavioralEventNames).toHaveLength(46);
    expect(new Set(behavioralEventNames).size).toBe(behavioralEventNames.length);
    expect(behavioralEventNames).toContain('landing_try_clicked');
    expect(behavioralEventNames).toContain('recommendation_followed');
    expect(behavioralEventNames).toContain('correction_internalized');
  });

  it('accepts typed properties and rejects unapproved properties', () => {
    const event = { name: 'page_viewed', ...base, route: '/courses/[slug]', referrer_route: '/dashboard' };
    expect(behavioralEventSchema.safeParse(event).success).toBe(true);
    expect(behavioralEventSchema.safeParse({ ...event, email: 'student@example.com' }).success).toBe(false);
    expect(behavioralEventSchema.safeParse({ ...event, free_text: 'private note' }).success).toBe(false);
    expect(behavioralEventSchema.safeParse({ ...event, raw_url: 'https://studyus.app/courses/secret?token=x' }).success).toBe(false);
  });

  it('lets browser callers provide event properties while the wrapper owns base properties', () => {
    expect(
      enrichBehavioralEvent(
        { name: 'page_viewed', route: '/dashboard' },
        { user_id: 'user-1', session_id: 'session-1', surface: '/dashboard', ts: 1_800_000_000_000, viewport: 'mobile' },
      ),
    ).toEqual({
      name: 'page_viewed',
      route: '/dashboard',
      user_id: 'user-1',
      session_id: 'session-1',
      surface: '/dashboard',
      ts: 1_800_000_000_000,
      viewport: 'mobile',
    });
  });

  it('allows route patterns but not raw URLs, queries, or fragments', () => {
    for (const route of ['https://studyus.app/dashboard', '/dashboard?course=secret', '/dashboard#today']) {
      expect(behavioralEventSchema.safeParse({ name: 'page_viewed', ...base, route }).success).toBe(false);
    }
  });

  it('keeps enum and numeric properties bounded', () => {
    expect(
      behavioralEventSchema.safeParse({
        name: 'next_move_viewed',
        ...base,
        recommendation_id: 'rec-1',
        rank: 1,
        kind: 'frontier_understand',
        available_minutes: 25,
      }).success,
    ).toBe(true);
    expect(
      behavioralEventSchema.safeParse({
        name: 'next_move_viewed',
        ...base,
        recommendation_id: 'rec-1',
        rank: 1,
        kind: 'freeform-kind',
        available_minutes: 42,
      }).success,
    ).toBe(false);
  });
});
