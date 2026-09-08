import { describe, expect, it } from 'vitest';
import type { CalendarItem } from '../src/lib/types/calendar';
import {
  addDateKeyDays,
  calendarItemDateKey,
  daysUntil,
  formatZonedDate,
  zonedDateKey,
  zonedDayBounds,
} from '../src/lib/plannerDates';

const TORONTO = 'America/Toronto';
const BROWSER_INSTANT = new Date('2026-09-08T02:47:00.000Z');

function item(overrides: Partial<CalendarItem>): CalendarItem {
  return {
    id: 'item-1',
    type: 'study_session',
    title: 'Study',
    date: '2026-09-08T02:30:00.000Z',
    end_date: null,
    all_day: false,
    course_id: null,
    href: null,
    details: {},
    ...overrides,
  };
}

describe('canonical user-timezone calendar dates', () => {
  it('keeps SSR labels, today classification, and the rolling week on the Toronto day', () => {
    const todayKey = zonedDateKey(BROWSER_INSTANT, TORONTO);
    expect(todayKey).toBe('2026-09-07');
    expect(formatZonedDate(BROWSER_INSTANT, TORONTO, { weekday: 'long', month: 'long', day: 'numeric' }))
      .toMatch(/Monday.*September.*7|Monday.*7.*September/);
    expect(daysUntil('2026-09-07T16:00:00.000Z', BROWSER_INSTANT, TORONTO)).toBe(0);
    expect(Array.from({ length: 7 }, (_, index) => addDateKeyDays(todayKey, index)))
      .toEqual(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);
    expect(calendarItemDateKey(item({}), TORONTO)).toBe(todayKey);
  });

  it('keeps synthetic class and provider date-only values on their encoded calendar day', () => {
    expect(calendarItemDateKey(item({
      type: 'class_session',
      date: '2026-09-08T01:00:00.000Z',
      details: { start_min: 60, end_min: 120 },
    }), TORONTO)).toBe('2026-09-08');
    expect(calendarItemDateKey(item({
      type: 'external_event',
      date: '2026-09-08T12:00:00.000Z',
      all_day: true,
      details: { date_only: '2026-09-08' },
    }), TORONTO)).toBe('2026-09-08');
  });

  it('returns real DST-aware local-day query bounds', () => {
    const spring = zonedDayBounds('2026-03-08', TORONTO);
    const fall = zonedDayBounds('2026-11-01', TORONTO);
    expect(spring.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 60 * 60_000);
    expect(fall.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * 60 * 60_000);
  });
});
