import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TodayTasks from '../../src/components/dashboard/TodayTasks.svelte';
import WeekView from '../../src/components/dashboard/WeekView.svelte';
import PlannerView from '../../src/components/planner/PlannerView.svelte';
import { tasksById, tasksStatus } from '../../src/lib/stores/tasks';

const NOW = Date.parse('2026-09-08T02:47:00.000Z');
const TIMEZONE = 'America/Toronto';

describe('dashboard canonical timezone hydration', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    localStorage.clear();
    tasksById.set({});
    tasksStatus.set('idle');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('classifies the Toronto Sep 7 task as Today after hydration', () => {
    render(TodayTasks, {
      props: {
        initialTasks: [{
          id: 'task-1',
          title: 'Toronto evening task',
          due_date: '2026-09-07T16:00:00.000Z',
          completed: false,
          courses: [],
        }],
        courses: [],
        timezone: TIMEZONE,
        initialNow: NOW,
      },
    });

    expect(screen.getByText('Toronto evening task')).toBeTruthy();
    expect(screen.getByText('Toronto evening task').closest('.section')?.querySelector('.section-label')?.textContent).toContain('Today');
  });

  it('starts the rolling week on Toronto Monday Sep 7 and groups a late-evening instant there', () => {
    const { container } = render(WeekView, {
      props: {
        initialItems: [{
          id: 'session-1',
          type: 'study_session',
          title: 'Late Toronto study',
          date: '2026-09-08T02:30:00.000Z',
          end_date: '2026-09-08T03:00:00.000Z',
          all_day: false,
          course_id: null,
          href: null,
          details: {},
        }],
        courses: [],
        timezone: TIMEZONE,
        initialNow: NOW,
      },
    });

    const firstDay = container.querySelector('.week .day');
    expect(firstDay?.querySelector('.wd')?.textContent).toMatch(/Mon/i);
    expect(firstDay?.querySelector('.n')?.textContent).toBe('7');
    expect(firstDay?.textContent).toContain('Late Toronto study');
  });

  it('hydrates the planner on the same Toronto week as the server anchor', async () => {
    const { container } = render(PlannerView, {
      props: {
        courses: [],
        currentTerm: null,
        initialItems: [],
        initialAnchor: '2026-09-07T04:00:00.000Z',
        timezone: TIMEZONE,
        initialNow: NOW,
      },
    });

    const range = container.querySelector('.range-label')?.textContent ?? '';
    expect(range).toMatch(/Sep.*7/);
    expect(range).toMatch(/13.*2026/);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
});
