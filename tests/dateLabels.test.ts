// Coverage for the "due in N days" day-math and date-label formatters added
// to src/lib/plannerDates.ts to consolidate TaskItem/DeadlinesList/
// PlannerRail's independent implementations, plus the ~7 hand-rolled
// toLocaleDateString/relative-time formatters across the standing cards,
// the notifications bell, and the dashboard deadlines list. Locale-formatted
// strings (formatShortDate etc.) are asserted loosely (contains the day
// number) rather than pinned to one locale's exact separators.
import { describe, expect, it } from 'vitest';
import type { CalendarItem } from '../src/lib/types/calendar';
import {
  addMinutes,
  calendarItemStartLabel,
  calendarItemTimeLabel,
  classSessionLocalDate,
  daysUntil,
  deadlineUrgency,
  formatDueDate,
  formatRelative,
  formatRelativeTime,
  formatShortDate,
  formatWeekdayAndDate,
  railDueLabel,
  resolvedEventTimes,
  snap15,
  taskDueMeta,
} from '../src/lib/plannerDates';

const NOW = new Date('2026-08-15T12:00:00');

function daysFromNow(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

describe('daysUntil', () => {
  it('is 0 for today regardless of time-of-day', () => {
    expect(daysUntil(new Date('2026-08-15T23:59:00'), NOW)).toBe(0);
    expect(daysUntil(new Date('2026-08-15T00:00:01'), NOW)).toBe(0);
  });

  it('counts whole calendar days into the future and past', () => {
    expect(daysUntil(daysFromNow(1), NOW)).toBe(1);
    expect(daysUntil(daysFromNow(7), NOW)).toBe(7);
    expect(daysUntil(daysFromNow(-1), NOW)).toBe(-1);
    expect(daysUntil(daysFromNow(-5), NOW)).toBe(-5);
  });

  it('accepts a Date, an ISO string, or an epoch-ms number', () => {
    const iso = daysFromNow(2);
    expect(daysUntil(new Date(iso), NOW)).toBe(2);
    expect(daysUntil(iso, NOW)).toBe(2);
    expect(daysUntil(new Date(iso).getTime(), NOW)).toBe(2);
  });
});

describe('taskDueMeta (TaskItem due pill)', () => {
  it('overdue is danger, not attend_class', () => {
    expect(taskDueMeta(-1)).toEqual({ label: 'overdue', danger: true });
  });

  it('overdue attend_class sinks to a non-danger "catch up"', () => {
    expect(taskDueMeta(-3, true)).toEqual({ label: 'catch up', danger: false });
  });

  it('today and tomorrow', () => {
    expect(taskDueMeta(0)).toEqual({ label: 'Today', danger: false });
    expect(taskDueMeta(1)).toEqual({ label: 'Tomorrow', danger: false });
  });

  it('further out is "in Nd", never danger', () => {
    expect(taskDueMeta(5)).toEqual({ label: 'in 5d', danger: false });
  });
});

describe('deadlineUrgency (dashboard/DeadlinesList due pill)', () => {
  it('overdue and today are pill-danger', () => {
    expect(deadlineUrgency(-1)).toEqual({ cls: 'pill-danger', label: 'overdue' });
    expect(deadlineUrgency(0)).toEqual({ cls: 'pill-danger', label: 'Today' });
  });

  it('tomorrow through 3 days out is the pill-warn tier', () => {
    expect(deadlineUrgency(1)).toEqual({ cls: 'pill-warn', label: 'Tomorrow' });
    expect(deadlineUrgency(2)).toEqual({ cls: 'pill-warn', label: 'in 2d' });
    expect(deadlineUrgency(3)).toEqual({ cls: 'pill-warn', label: 'in 3d' });
  });

  it('past 3 days out is pill-idle, with the same "in Nd" label text', () => {
    expect(deadlineUrgency(4)).toEqual({ cls: 'pill-idle', label: 'in 4d' });
  });
});

describe('railDueLabel (PlannerRail due label)', () => {
  it('overdue uses "Nd overdue" wording, not "overdue"', () => {
    expect(railDueLabel(-1, daysFromNow(-1))).toBe('1d overdue');
    expect(railDueLabel(-5, daysFromNow(-5))).toBe('5d overdue');
  });

  it('today and tomorrow', () => {
    expect(railDueLabel(0, daysFromNow(0))).toBe('Today');
    expect(railDueLabel(1, daysFromNow(1))).toBe('Tomorrow');
  });

  it('further out renders an actual calendar date, not "in Nd"', () => {
    const label = railDueLabel(5, daysFromNow(5));
    expect(label).not.toMatch(/in \d+d/);
    expect(label).toMatch(/\d/); // contains a day-of-month digit
  });
});

describe('snap15 (WeekGrid click + drag-create snapping)', () => {
  it('floors down to the nearest 15-minute mark', () => {
    expect(snap15(new Date('2026-08-15T09:07:00')).toISOString()).toBe(new Date('2026-08-15T09:00:00').toISOString());
    expect(snap15(new Date('2026-08-15T09:14:59')).toISOString()).toBe(new Date('2026-08-15T09:00:00').toISOString());
    expect(snap15(new Date('2026-08-15T09:15:00')).toISOString()).toBe(new Date('2026-08-15T09:15:00').toISOString());
    expect(snap15(new Date('2026-08-15T09:44:00')).toISOString()).toBe(new Date('2026-08-15T09:30:00').toISOString());
  });

  it('clears seconds/ms so two snaps of the same minute always match', () => {
    const a = snap15(new Date('2026-08-15T09:07:12.500'));
    const b = snap15(new Date('2026-08-15T09:07:59.999'));
    expect(a.getTime()).toBe(b.getTime());
  });
});

describe('addMinutes (drag-range math + EventPopover reschedule nudges)', () => {
  it('adds positive and negative minute offsets', () => {
    const base = new Date('2026-08-15T09:00:00');
    expect(addMinutes(base, 30).toISOString()).toBe(new Date('2026-08-15T09:30:00').toISOString());
    expect(addMinutes(base, -30).toISOString()).toBe(new Date('2026-08-15T08:30:00').toISOString());
  });

  it('does not mutate the input Date', () => {
    const base = new Date('2026-08-15T09:00:00');
    const before = base.getTime();
    addMinutes(base, 45);
    expect(base.getTime()).toBe(before);
  });
});

// class_session helpers (v1.6.1): the fix for the "class times render 12h+
// off" bug — a class_session's `date`/`end_date` ISO fields are a
// best-effort absolute instant that is only meaningful for sorting/windowing
// (see types/calendar.ts's contract comment); its real wall-clock time comes
// exclusively from `details.start_min`/`end_min`. Every assertion below
// deliberately sets `date`'s hour to something implausible for the class
// (e.g. 3am) to prove the resolved time comes from start_min, not from
// parsing the ISO's hour/minute.
function classSessionItem(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: 'cs-1',
    type: 'class_session',
    title: 'Class: TEST 101',
    date: '2026-08-17T03:00:00.000Z', // deliberately not 10:05 — must be ignored
    end_date: '2026-08-17T03:00:00.000Z',
    all_day: false,
    course_id: 'course-1',
    href: '/courses/test-101',
    details: { status: null, note: null, source: 'seed', task_id: null, start_min: 605, end_min: 685 },
    ...overrides,
  };
}

describe('classSessionLocalDate', () => {
  it('builds local midnight + minutesSinceMidnight, independent of the anchor ISO time-of-day', () => {
    const d = classSessionLocalDate('2026-08-17T03:00:00.000Z', 605); // 605min = 10:05
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(5);
  });

  it('only uses the anchor ISO for its calendar day', () => {
    const d = classSessionLocalDate('2026-08-17T23:55:00.000Z', 0);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(new Date('2026-08-17T23:55:00.000Z').getDate());
  });
});

describe('resolvedEventTimes / calendarItemTimeLabel (class_session 12h-offset fix)', () => {
  it('resolves a class_session from details.start_min/end_min, not the ISO hour', () => {
    const { startMs, endMs } = resolvedEventTimes(classSessionItem());
    const start = new Date(startMs);
    const end = new Date(endMs!);
    expect(start.getHours()).toBe(10);
    expect(start.getMinutes()).toBe(5);
    expect(end.getHours()).toBe(11);
    expect(end.getMinutes()).toBe(25);
  });

  it('falls back to parsing the ISO when start_min/end_min are absent (older/partial data)', () => {
    const item = classSessionItem({ date: '2026-08-17T14:05:00.000Z', end_date: '2026-08-17T15:25:00.000Z', details: {} });
    const { startMs, endMs } = resolvedEventTimes(item);
    expect(startMs).toBe(Date.parse('2026-08-17T14:05:00.000Z'));
    expect(endMs).toBe(Date.parse('2026-08-17T15:25:00.000Z'));
  });

  it('leaves every other item type resolving straight from the ISO, unchanged', () => {
    const item: CalendarItem = {
      id: 's-1',
      type: 'study_session',
      title: 'Study: TEST 101',
      date: '2026-08-17T09:00:00.000Z',
      end_date: '2026-08-17T09:45:00.000Z',
      all_day: false,
      course_id: 'course-1',
      href: '/planner',
      details: {},
    };
    const { startMs, endMs } = resolvedEventTimes(item);
    expect(startMs).toBe(Date.parse('2026-08-17T09:00:00.000Z'));
    expect(endMs).toBe(Date.parse('2026-08-17T09:45:00.000Z'));
  });

  // Loosely asserted (contains the digits), same locale-formatting caveat as
  // the plain formatters below — toLocaleTimeString's exact separators/AM-PM
  // whitespace aren't pinned to one ICU build.
  it('calendarItemTimeLabel renders the class_session range from start_min/end_min', () => {
    const label = calendarItemTimeLabel(classSessionItem());
    expect(label).toMatch(/10:05/);
    expect(label).toMatch(/11:25/);
    expect(label).not.toMatch(/3:00|03:00/); // the ISO's (wrong) hour must never leak through
  });

  it('calendarItemStartLabel renders just the start', () => {
    const label = calendarItemStartLabel(classSessionItem());
    expect(label).toMatch(/10:05/);
    expect(label).not.toMatch(/11:25/);
  });
});

describe('plain formatters', () => {
  it('formatShortDate renders month + day', () => {
    expect(formatShortDate('2026-08-15T12:00:00Z')).toMatch(/Aug/);
  });

  it('formatDueDate falls back to "No due date" for null', () => {
    expect(formatDueDate(null)).toBe('No due date');
  });

  it('formatDueDate includes the year for a real date', () => {
    expect(formatDueDate('2026-08-15T12:00:00Z')).toMatch(/2026/);
  });

  it('formatRelative: today/yesterday/N days ago/Nw ago/absolute date', () => {
    expect(formatRelative(new Date().toISOString())).toBe('today');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatRelative(yesterday.toISOString())).toBe('yesterday');
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    expect(formatRelative(threeDaysAgo.toISOString())).toBe('3 days ago');
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    expect(formatRelative(twoWeeksAgo.toISOString())).toBe('2w ago');
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60);
    expect(formatRelative(twoMonthsAgo.toISOString())).toMatch(/[A-Za-z]{3}/); // falls back to a short date
  });

  it('formatRelativeTime: just now/minutes/hours/days (no absolute-date fallback)', () => {
    const now = new Date();
    expect(formatRelativeTime(now.toISOString())).toBe('just now');
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    expect(formatRelativeTime(fiveMinAgo.toISOString())).toBe('5m ago');
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60_000);
    expect(formatRelativeTime(threeHoursAgo.toISOString())).toBe('3h ago');
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
    expect(formatRelativeTime(twoDaysAgo.toISOString())).toBe('2d ago');
  });

  it('formatWeekdayAndDate returns separate weekday and date strings', () => {
    const { weekday, date } = formatWeekdayAndDate('2026-08-15T12:00:00Z');
    expect(weekday.length).toBeGreaterThan(0);
    expect(date).toMatch(/Aug/);
  });
});
