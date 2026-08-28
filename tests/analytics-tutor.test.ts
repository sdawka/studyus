import { describe, expect, it, vi } from 'vitest';
import { createTutorOpenedAnalytics, tutorSurfaceForEntry } from '../src/lib/analytics/tutor';

describe('tutor client analytics', () => {
  it('captures one opened event for a rendered conversation without content fields', () => {
    const capture = vi.fn();
    const analytics = createTutorOpenedAnalytics(capture);

    analytics.opened('conversation-1', 'recall', 'kc-1', 'course');
    analytics.opened('conversation-1', 'recall', 'kc-1', 'course');

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith({
      name: 'tutor_opened',
      conversation_id: 'conversation-1',
      mode: 'recall',
      kc_id: 'kc-1',
      entry: 'course',
    });
    expect(JSON.stringify(capture.mock.calls)).not.toMatch(/content|message_text|answer|note|email/);
  });

  it('maps only the maintained product entry enums to route patterns', () => {
    expect(tutorSurfaceForEntry('direct')).toBe('/tutor/[kcId]');
    expect(tutorSurfaceForEntry('course')).toBe('/tutor/[kcId]');
    expect(tutorSurfaceForEntry('next_move')).toBe('/learn/[kcId]');
    expect(tutorSurfaceForEntry('absorb')).toBe('/learn/[kcId]');
  });
});
