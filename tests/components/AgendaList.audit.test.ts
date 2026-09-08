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

  it('does not describe a future class as already recorded', () => {
    render(AgendaList, { props: { items: [item({ type: 'class_session', title: 'Future class', date: '2026-09-09T12:00:00.000Z' })], courseById } });
    expect(screen.getByRole('button', { name: /Future class/ }).querySelector('.pill')?.textContent).toBe('upcoming');
  });

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

    it('keeps completed history neutral', () => {
      expect(observedHistoryPills).toEqual(['recorded', 'recorded']);
    });
  });

  it('only labels outstanding tasks and assessments as overdue', () => {
    render(AgendaList, {
      props: {
        items: [
          item({ id: 'past-task', title: 'Past task', date: '2026-09-05T12:00:00.000Z', type: 'task_due' }),
          item({ id: 'past-assessment', title: 'Past assessment', date: '2026-09-05T12:00:00.000Z', type: 'assessment_due' }),
          item({ id: 'completed-task', title: 'Completed task', date: '2026-09-05T12:00:00.000Z', type: 'task_due', details: { done: true } }),
          item({ id: 'graded-assessment', title: 'Graded assessment', date: '2026-09-05T12:00:00.000Z', type: 'assessment_due', details: { grade_received: 88 } }),
          item({ id: 'past-session', title: 'Past study session', date: '2026-09-05T12:00:00.000Z', type: 'study_session' }),
          item({ id: 'past-external', title: 'Past external event', date: '2026-09-05T12:00:00.000Z', type: 'external_event' }),
        ],
        courseById,
      },
    });

    expect(screen.getByRole('button', { name: /Past task/ }).querySelector('.pill')?.textContent?.trim()).toBe('overdue');
    expect(screen.getByRole('button', { name: /Past assessment/ }).querySelector('.pill')?.textContent?.trim()).toBe('overdue');
    expect(screen.getByRole('button', { name: /Completed task/ }).querySelector('.pill')?.textContent?.trim()).toBe('recorded');
    expect(screen.getByRole('button', { name: /Graded assessment/ }).querySelector('.pill')?.textContent?.trim()).toBe('recorded');
    expect(screen.getByRole('button', { name: /Past study session/ }).querySelector('.pill')?.textContent?.trim()).toBe('recorded');
    expect(screen.getByRole('button', { name: /Past external event/ }).querySelector('.pill')?.textContent?.trim()).toBe('recorded');
  });
});
