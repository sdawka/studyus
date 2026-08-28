import { describe, expect, it } from 'vitest';
import {
  createNotificationAnalytics,
  createRecordEventAnalytics,
  createResourceAnalytics,
  taskCheckedEvent,
  taskDismissedEvent,
} from '../src/lib/analytics/engagement';
import type { BehavioralEventInput } from '../src/lib/analytics/events';

function recorder() {
  const events: BehavioralEventInput[] = [];
  return { events, capture: (event: BehavioralEventInput) => events.push(event) };
}

describe('engagement analytics protocol', () => {
  it('builds privacy-bounded task outcomes with route patterns and local overdue state', () => {
    expect(taskCheckedEvent(
      { type: 'practice_kc', due_date: '2026-08-27T16:00:00.000Z' },
      '/courses/[slug]',
      new Date('2026-08-28T12:00:00.000Z'),
    )).toEqual({
      name: 'task_checked',
      task_type: 'practice_kc',
      source_surface: '/courses/[slug]',
      overdue: true,
    });
    expect(taskCheckedEvent({ type: 'todo' }, '/tasks')).toMatchObject({ overdue: false });
    expect(taskDismissedEvent({ type: 'stale_kc' }, '/dashboard')).toEqual({
      name: 'task_dismissed',
      task_type: 'stale_kc',
      source_surface: '/dashboard',
    });
  });

  it('keeps opened before submitted and deduplicates the same D5 attempt', () => {
    const { events, capture } = recorder();
    const analytics = createRecordEventAnalytics(capture);

    analytics.opened();
    analytics.opened();
    analytics.submitted('reading_done', 'attempt-1');
    analytics.submitted('reading_done', 'attempt-1');
    analytics.submitted('reading_done', 'attempt-2');

    expect(events).toEqual([
      { name: 'record_event_opened' },
      { name: 'record_event_submitted', event_type: 'reading_done' },
      { name: 'record_event_opened' },
      { name: 'record_event_submitted', event_type: 'reading_done' },
    ]);
  });

  it('deduplicates notification double activation without sending its id', () => {
    const { events, capture } = recorder();
    const analytics = createNotificationAnalytics(capture);
    analytics.opened('notification-1', 'correction_review');
    analytics.opened('notification-1', 'correction_review');

    expect(events).toEqual([{ name: 'notification_opened', notification_type: 'correction_review' }]);
  });

  it('deduplicates repeated opens of the same logical resource', () => {
    const { events, capture } = recorder();
    const analytics = createResourceAnalytics(capture);
    analytics.opened('resource-1', 'feed');
    analytics.opened('resource-1', 'shared');

    expect(events).toEqual([{ name: 'resource_opened', resource_id: 'resource-1', origin: 'feed' }]);
  });
});
