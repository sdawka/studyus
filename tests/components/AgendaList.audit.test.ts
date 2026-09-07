import { render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgendaList from '../../src/components/planner/AgendaList.svelte';
import type { CalendarItem } from '../../src/lib/types/calendar';

const courseById = new Map([['course-1', { code: 'HIST101', slug: 'history', color: 30 }]]);

function item(overrides: Partial<CalendarItem>): CalendarItem {
  return {
    id: 'item-1',
    type: 'task_due',
    title: 'Outstanding reading',
    date: '2026-09-08T12:00:00.000Z',
    end_date: null,
    all_day: true,
    course_id: 'course-1',
    href: null,
    details: {},
    ...overrides,
  };
}

describe('AgendaList urgency', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-07T12:00:00.000Z') }));
  afterEach(() => vi.useRealTimers());

  it('keeps a future outstanding deadline actionable', () => {
    render(AgendaList, { props: { items: [item({ date: '2026-09-09T12:00:00.000Z' })], courseById } });

    const row = screen.getByRole('button', { name: /Outstanding reading/ });
    expect(row.textContent).toContain('in 2d');
    expect(row.textContent).not.toContain('overdue');
  });

  describe('when historical calendar records are in the past', () => {
    let observedHistoryPills: string[];

    beforeEach(() => {
      render(AgendaList, {
        props: {
          items: [
            item({
              id: 'class-history',
              type: 'class_session',
              title: 'Class attended',
              date: '2026-09-05T12:00:00.000Z',
              details: { status: 'attended', start_min: 540, end_min: 600 },
            }),
            item({
              id: 'quiz-history',
              type: 'event_logged',
              title: 'Quiz logged',
              date: '2026-09-06T12:00:00.000Z',
              details: { event_type: 'quiz_taken', source: 'manual' },
            }),
          ],
          courseById,
        },
      });

      observedHistoryPills = ['Class attended', 'Quiz logged'].map((title) => {
        const row = screen.getByRole('button', { name: new RegExp(title) });
        return row.querySelector('.pill')?.textContent?.trim() ?? '';
      });
      expect(observedHistoryPills).toHaveLength(2);
    });

    // Known planner defect: the list applies deadlineUrgency to every calendar
    // item, including completed class sessions and logged events. These are
    // historical records, so a past date must not imply an overdue obligation.
    it.fails('does not label completed history as overdue', () => {
      expect(observedHistoryPills).not.toContain('overdue');
    });
  });
});
