import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlannerView from '../../src/components/planner/PlannerView.svelte';
import type { CalendarItem } from '../../src/lib/types/calendar';

type PendingRequest = {
  url: URL;
  resolve: (response: Response) => void;
};

const TIMEZONE = 'America/Toronto';
const NOW = Date.parse('2026-09-08T14:00:00.000Z');

function deferredFetches() {
  const pending: PendingRequest[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => new Promise<Response>((resolve) => {
    pending.push({ url: new URL(String(input), 'http://localhost'), resolve });
  })));
  return pending;
}

function calendarRequest(pending: PendingRequest[], days: number, occurrence = 0) {
  const requests = pending.filter(({ url }) => {
    if (url.pathname !== '/api/v1/calendar') return false;
    const from = Date.parse(url.searchParams.get('from') ?? '');
    const to = Date.parse(url.searchParams.get('to') ?? '');
    return Math.round((to - from) / 86_400_000) === days;
  });
  expect(requests[occurrence], `calendar request for ${days} days #${occurrence + 1}`).toBeTruthy();
  return requests[occurrence]!;
}

function response(data: CalendarItem[], ok = true, message = 'Request failed') {
  return {
    ok,
    json: async () => ok ? { data } : { error: { message } },
  } as Response;
}

async function flushCalendarResponse() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function item(id: string, title: string, date: string): CalendarItem {
  return {
    id,
    type: 'study_session',
    title,
    date,
    end_date: new Date(Date.parse(date) + 30 * 60_000).toISOString(),
    all_day: false,
    course_id: null,
    href: null,
    details: {},
  };
}

function renderPlanner() {
  return render(PlannerView, {
    props: {
      courses: [{ id: 'course-1', slug: 'course', code: 'COURSE', title: 'Course', term: null, color: null }],
      currentTerm: null,
      initialItems: [],
      timezone: TIMEZONE,
      initialNow: NOW,
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PlannerView calendar request ownership', () => {
  it('keeps the active week when an older week response succeeds late', async () => {
    const pending = deferredFetches();
    renderPlanner();
    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    const firstWeek = calendarRequest(pending, 7);

    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(pending.filter(({ url }) => {
      const from = Date.parse(url.searchParams.get('from') ?? '');
      const to = Date.parse(url.searchParams.get('to') ?? '');
      return Math.round((to - from) / 86_400_000) === 7;
    })).toHaveLength(2));
    const secondWeek = calendarRequest(pending, 7, 1);

    secondWeek.resolve(response([item('current-week', 'Current week session', '2026-09-15T14:00:00.000Z')]));
    await screen.findByText('Current week session');

    firstWeek.resolve(response([item('stale-week', 'Stale week session', '2026-09-08T14:00:00.000Z')]));
    await flushCalendarResponse();

    expect(screen.getByText('Current week session')).toBeTruthy();
    expect(screen.queryByText('Stale week session')).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('keeps loading and clears no active state when an older week request fails during a month request', async () => {
    const pending = deferredFetches();
    renderPlanner();
    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    const firstWeek = calendarRequest(pending, 7);

    await fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    await waitFor(() => expect(pending.filter(({ url }) => {
      const from = Date.parse(url.searchParams.get('from') ?? '');
      const to = Date.parse(url.searchParams.get('to') ?? '');
      return Math.round((to - from) / 86_400_000) >= 28;
    })).toHaveLength(2));
    const month = calendarRequest(pending, 30, 0);

    firstWeek.resolve(response([], false, 'The old week failed'));
    await flushCalendarResponse();

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('The old week failed')).toBeNull();

    month.resolve(response([item('month-session', 'Current month session', '2026-09-15T14:00:00.000Z')]));
    await screen.findByText('Current month session');
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByText('The old week failed')).toBeNull();
  });

  it('keeps the latest rail result when an older rail request resolves late', async () => {
    const pending = deferredFetches();
    renderPlanner();
    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    const firstRail = calendarRequest(pending, 37);

    const courseSelect = screen.getByRole('combobox');
    await fireEvent.change(courseSelect, { target: { value: 'course-1' } });
    await waitFor(() => expect(pending.filter(({ url }) => {
      const from = Date.parse(url.searchParams.get('from') ?? '');
      const to = Date.parse(url.searchParams.get('to') ?? '');
      return Math.round((to - from) / 86_400_000) === 37;
    })).toHaveLength(2));
    const secondRail = calendarRequest(pending, 37, 1);

    secondRail.resolve(response([{
      ...item('latest-rail', 'Latest rail task', '2026-09-10T14:00:00.000Z'),
      type: 'task_due',
    }]));
    await screen.findByText('Latest rail task');

    firstRail.resolve(response([{
      ...item('stale-rail', 'Stale rail task', '2026-09-09T14:00:00.000Z'),
      type: 'task_due',
    }]));
    await flushCalendarResponse();

    expect(screen.getByText('Latest rail task')).toBeTruthy();
    expect(screen.queryByText('Stale rail task')).toBeNull();
  });
});
