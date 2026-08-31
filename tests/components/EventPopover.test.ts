// Characterization tests for EventPopover.svelte — these pin what the
// component does TODAY (including behavior that is arguably a bug) so a
// later decomposition has a safety net. Do NOT "fix" a failing assertion
// here without checking whether it's one of the deliberately-pinned bugs
// called out in a comment below.
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import EventPopover from '../../src/components/planner/EventPopover.svelte';
import type { CalendarItem, CalendarItemType } from '../../src/lib/types/calendar';
import { hueFor } from '../../src/lib/courseHue';
import { calendarItemTimeLabel } from '../../src/lib/plannerDates';
import type { ApiResult } from '../../src/lib/apiClient';

vi.mock('../../src/lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/apiClient')>();
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock('../../src/lib/analytics/client', () => ({
  captureBehavioralEvent: vi.fn(),
  currentAnalyticsSurface: vi.fn(() => undefined as string | undefined),
}));
vi.mock('../../src/lib/analytics/engagement', () => ({
  taskCheckedEvent: vi.fn(() => ({ name: 'task_checked', task_type: 'todo', source_surface: 'x', overdue: false })),
}));
vi.mock('../../src/lib/confetti', () => ({
  burstConfetti: vi.fn(),
}));
vi.mock('../../src/lib/completionMotion', () => ({
  markFlowCelebration: vi.fn(),
  recentFlowCelebration: vi.fn(() => false),
  prefersReducedMotion: vi.fn(() => false),
}));
vi.mock('../../src/lib/stores/tasks', () => ({
  tasksById: { get: vi.fn(() => ({}) as Record<string, { id: string; completed: boolean }>) },
  toggleTask: vi.fn(async () => true),
}));

import { apiFetch, NETWORK_ERROR_MESSAGE } from '../../src/lib/apiClient';
import { captureBehavioralEvent, currentAnalyticsSurface } from '../../src/lib/analytics/client';
import { burstConfetti } from '../../src/lib/confetti';
import { markFlowCelebration } from '../../src/lib/completionMotion';
import { tasksById, toggleTask } from '../../src/lib/stores/tasks';

const apiFetchMock = vi.mocked(apiFetch);
const tasksByIdGetMock = vi.mocked(tasksById.get);
const toggleTaskMock = vi.mocked(toggleTask);
const currentAnalyticsSurfaceMock = vi.mocked(currentAnalyticsSurface);
const captureBehavioralEventMock = vi.mocked(captureBehavioralEvent);
const burstConfettiMock = vi.mocked(burstConfetti);
const markFlowCelebrationMock = vi.mocked(markFlowCelebration);

interface CourseOption {
  id: string;
  slug: string;
  code: string;
  title: string;
  color: number | null;
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}
function httpErr(error: string): ApiResult<never> {
  return { ok: false, error, reason: 'http' };
}
function networkErr(error: string = NETWORK_ERROR_MESSAGE): ApiResult<never> {
  return { ok: false, error, reason: 'network' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeItem(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: 'item-1',
    type: 'task_due',
    title: 'Sample item',
    date: '2026-08-20T15:00:00.000Z',
    end_date: null,
    all_day: false,
    course_id: null,
    href: null,
    details: {},
    ...overrides,
  };
}

function makeCourse(overrides: Partial<CourseOption> = {}): CourseOption {
  return { id: 'course-1', slug: 'cs101', code: 'CS101', title: 'Intro to CS', color: null, ...overrides };
}

const anchorRect = { x: 100, y: 100, width: 20, height: 20 };

function renderPopover(props: {
  item: CalendarItem;
  course?: CourseOption;
  onClose?: () => void;
  onDeleted?: () => void;
  onTaskToggled?: (itemId: string, done: boolean) => void;
  onItemUpdated?: (itemId: string, patch: Partial<CalendarItem>) => void;
  plannerLink?: string | null;
}) {
  const onClose = props.onClose ?? vi.fn();
  const onDeleted = props.onDeleted ?? vi.fn();
  const onTaskToggled = props.onTaskToggled ?? vi.fn();
  const onItemUpdated = props.onItemUpdated ?? vi.fn();
  const result = render(EventPopover, {
    props: {
      item: props.item,
      course: props.course,
      anchorRect,
      onClose,
      onDeleted,
      onTaskToggled,
      onItemUpdated,
      plannerLink: props.plannerLink ?? null,
    },
  });
  return { ...result, onClose, onDeleted, onTaskToggled, onItemUpdated };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  apiFetchMock.mockReset();
  tasksByIdGetMock.mockReset();
  tasksByIdGetMock.mockReturnValue({});
  toggleTaskMock.mockReset();
  toggleTaskMock.mockResolvedValue(true);
  currentAnalyticsSurfaceMock.mockReset();
  currentAnalyticsSurfaceMock.mockReturnValue(undefined);
  captureBehavioralEventMock.mockReset();
  burstConfettiMock.mockReset();
  markFlowCelebrationMock.mockReset();
});

describe('type label per CalendarItemType', () => {
  const cases: Array<[CalendarItemType, string]> = [
    ['assessment_due', 'Assessment due'],
    ['task_due', 'Task due'],
    ['study_session', 'Study session'],
    ['event_logged', 'Logged event'],
    ['class_session', 'Class session'],
  ];

  it.each(cases)('renders the type pill for %s as %s', (type, label) => {
    renderPopover({ item: makeItem({ type }) });
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('renders a real type pill for external_event rather than a blank one', () => {
    const { container } = renderPopover({ item: makeItem({ type: 'external_event' }) });
    for (const [, label] of cases) {
      expect(screen.queryByText(label)).toBeNull();
    }
    const pill = container.querySelector('.pill-idle');
    expect(pill).not.toBeNull();
    expect(pill?.textContent?.trim()).toBe('Imported event');
  });
});

describe('all_day items', () => {
  it('an all_day:true item renders an "All day" label instead of a clock time', () => {
    const item = makeItem({ type: 'assessment_due', all_day: true, date: '2026-08-20T15:00:00.000Z', end_date: null });
    renderPopover({ item });
    expect(screen.getByText(/all day/i)).toBeTruthy();
    expect(screen.queryByText(calendarItemTimeLabel(item))).toBeNull();
  });

  it('an all_day:false item still renders its clock time', () => {
    const item = makeItem({ type: 'assessment_due', all_day: false, date: '2026-08-20T15:00:00.000Z', end_date: null });
    renderPopover({ item });
    expect(screen.getByText(calendarItemTimeLabel(item))).toBeTruthy();
    expect(screen.queryByText(/all day/i)).toBeNull();
  });
});

describe('course chip and hue fallback', () => {
  it('renders the course chip and derives hue from the course when a course is present', () => {
    const course = makeCourse({ slug: 'cs101', color: null });
    const { container } = renderPopover({ item: makeItem({ course_id: course.id }), course });
    expect(screen.getByText('CS101')).toBeTruthy();
    const expectedHue = hueFor({ slug: course.slug, color: null });
    const dialog = container.querySelector('.event-popover') as HTMLElement;
    expect(dialog.getAttribute('style')).toContain(`--course-h: ${expectedHue}`);
  });

  it('renders no course chip and falls back to hue 220 when course is undefined and item.course_id is null', () => {
    const { container } = renderPopover({ item: makeItem({ course_id: null }), course: undefined });
    expect(container.querySelector('.pop-chip')).toBeNull();
    const dialog = container.querySelector('.event-popover') as HTMLElement;
    expect(dialog.getAttribute('style')).toContain('--course-h: 220');
  });
});

describe('handleDelete — event_logged (manual source only)', () => {
  function manualItem() {
    return makeItem({ type: 'event_logged', details: { source: 'manual' } });
  }

  it('shows no delete button for a non-manual event_logged item', () => {
    renderPopover({ item: makeItem({ type: 'event_logged', details: { source: 'seeded' } }) });
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('deletes on success: calls onDeleted, closes the popover, no confirm step', async () => {
    apiFetchMock.mockResolvedValueOnce(ok({}));
    const { onDeleted, onClose } = renderPopover({ item: manualItem() });
    const button = screen.getByRole('button', { name: 'Delete' });
    await fireEvent.click(button);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/events/item-1', { method: 'DELETE' }, 'Could not delete this event.');
  });

  it('sets the in-flight flag during the request and clears it in finally', async () => {
    const { promise, resolve } = deferred<ApiResult<unknown>>();
    apiFetchMock.mockReturnValueOnce(promise);
    renderPopover({ item: manualItem() });
    const button = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    await fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Deleting…');
    resolve(ok({}));
    await waitFor(() => expect(button.disabled).toBe(false));
  });

  it('deleting an already-deleted item (404-style HTTP failure): rolls back, does not call onDeleted, shows the error, item stays', async () => {
    apiFetchMock.mockResolvedValueOnce(httpErr('Could not delete this event.'));
    const { onDeleted, onClose } = renderPopover({ item: manualItem() });
    const button = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    await fireEvent.click(button);
    await waitFor(() => expect(screen.getByText('Could not delete this event.')).toBeTruthy());
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it('network failure shows a different (generic) message than an HTTP failure', async () => {
    apiFetchMock.mockResolvedValueOnce(networkErr());
    const { onDeleted } = renderPopover({ item: manualItem() });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText(NETWORK_ERROR_MESSAGE)).toBeTruthy());
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByText('Could not delete this event.')).toBeNull();
  });

  it('REENTRANCY (pinned, no guard beyond the disabled attribute): two rapid clicks before the DOM flushes fire two requests', async () => {
    apiFetchMock.mockResolvedValue(ok({}));
    renderPopover({ item: manualItem() });
    const button = screen.getByRole('button', { name: 'Delete' });
    const p1 = fireEvent.click(button);
    const p2 = fireEvent.click(button);
    await Promise.all([p1, p2]);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('handleDelete — study_session (confirm-then-delete flow)', () => {
  function sessionItem(overrides: Partial<CalendarItem> = {}) {
    return makeItem({ type: 'study_session', details: { completed: false }, ...overrides });
  }

  it('first click arms the inline confirm, does not call the API yet', async () => {
    renderPopover({ item: sessionItem() });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this session?')).toBeTruthy();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('confirming deletes, calls onDeleted, and closes', async () => {
    apiFetchMock.mockResolvedValueOnce(ok({}));
    const { onDeleted, onClose } = renderPopover({ item: sessionItem() });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/sessions/item-1', { method: 'DELETE' }, 'Could not delete this session.');
  });

  it('cancel returns to the plain Delete button with no request sent', async () => {
    renderPopover({ item: sessionItem() });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete this session?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('HTTP failure on confirm: un-arms the confirm step, shows the error, does not call onDeleted', async () => {
    apiFetchMock.mockResolvedValueOnce(httpErr('Could not delete this session.'));
    const { onDeleted } = renderPopover({ item: sessionItem() });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('Could not delete this session.')).toBeTruthy());
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this session?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('network failure on confirm shows the generic network message, distinct from the HTTP-failure text', async () => {
    apiFetchMock.mockResolvedValueOnce(networkErr());
    renderPopover({ item: sessionItem() });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText(NETWORK_ERROR_MESSAGE)).toBeTruthy());
  });
});

describe('handleDelete — class_session has no delete affordance at all', () => {
  it('renders no delete button for class_session', () => {
    renderPopover({ item: makeItem({ type: 'class_session', details: {} }) });
    expect(screen.queryByRole('button', { name: /delete|confirm/i })).toBeNull();
  });
});

describe('handleTaskToggle', () => {
  function taskItem(done = false) {
    return makeItem({ type: 'task_due', details: { done, task_type: 'todo' }, date: '2026-08-20T00:00:00.000Z' });
  }

  it('checkbox reflects the initial details.done value', () => {
    renderPopover({ item: taskItem(true) });
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('non-hydrated fallback path, success: PATCHes the task, fires onTaskToggled once, no rollback', async () => {
    tasksByIdGetMock.mockReturnValue({});
    apiFetchMock.mockResolvedValueOnce(ok({}));
    const { onTaskToggled } = renderPopover({ item: taskItem(false) });
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    await fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(true));
    expect(onTaskToggled).toHaveBeenCalledTimes(1);
    expect(onTaskToggled).toHaveBeenNthCalledWith(1, 'item-1', true);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/tasks/item-1',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }) },
    );
    expect(toggleTaskMock).not.toHaveBeenCalled();
  });

  it('optimistic flip happens synchronously before the request settles', async () => {
    const { promise } = deferred<ApiResult<unknown>>();
    apiFetchMock.mockReturnValueOnce(promise);
    const { onTaskToggled } = renderPopover({ item: taskItem(false) });
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    await fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(onTaskToggled).toHaveBeenCalledTimes(1);
    expect(onTaskToggled).toHaveBeenNthCalledWith(1, 'item-1', true);
  });

  it('non-hydrated fallback path, HTTP failure: rolls back the checkbox and fires onTaskToggled a second time with the reverted value; no error message is ever shown for this handler', async () => {
    apiFetchMock.mockResolvedValueOnce(httpErr('nope'));
    const { onTaskToggled } = renderPopover({ item: taskItem(false) });
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    await fireEvent.click(checkbox);
    expect(onTaskToggled).toHaveBeenNthCalledWith(1, 'item-1', true); // optimistic
    await waitFor(() => expect(checkbox.checked).toBe(false)); // rolled back
    expect(onTaskToggled).toHaveBeenCalledTimes(2);
    expect(onTaskToggled).toHaveBeenNthCalledWith(2, 'item-1', false); // rollback
    // DEVIATION FROM BRIEF: handleTaskToggle has no error $state at all (unlike
    // the other four handlers), so there is nothing that distinguishes an
    // HTTP failure's message from a network failure's here — both just
    // silently roll back with zero user-visible text.
    expect(screen.queryByText(/error|could not|network/i)).toBeNull();
  });

  it('non-hydrated fallback path, network failure: rolls back identically to an HTTP failure (no message either way)', async () => {
    apiFetchMock.mockResolvedValueOnce(networkErr());
    const { onTaskToggled } = renderPopover({ item: taskItem(false) });
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    await fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox.checked).toBe(false));
    expect(onTaskToggled).toHaveBeenCalledTimes(2);
    expect(onTaskToggled).toHaveBeenNthCalledWith(2, 'item-1', false);
  });

  it('in-flight flag (taskToggling) disables the checkbox during the request and clears it after', async () => {
    const { promise, resolve } = deferred<ApiResult<unknown>>();
    apiFetchMock.mockReturnValueOnce(promise);
    renderPopover({ item: taskItem(false) });
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    await fireEvent.click(checkbox);
    expect(checkbox.disabled).toBe(true);
    resolve(ok({}));
    await waitFor(() => expect(checkbox.disabled).toBe(false));
  });

  it('hydrated store path: goes through toggleTask instead of a direct PATCH, and skips onTaskToggled a second time when the settled value matches the optimistic one', async () => {
    tasksByIdGetMock
      .mockReturnValueOnce({ 'item-1': { id: 'item-1', title: 'Task', courses: [], completed: false } }) // truthy check
      .mockReturnValueOnce({ 'item-1': { id: 'item-1', title: 'Task', courses: [], completed: true } }); // settled, matches optimistic
    const { onTaskToggled } = renderPopover({ item: taskItem(false) });
    await fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(toggleTaskMock).toHaveBeenCalledWith('item-1'));
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(onTaskToggled).toHaveBeenCalledTimes(1);
    expect(onTaskToggled).toHaveBeenNthCalledWith(1, 'item-1', true);
  });

  it('DOUBLE-FIRE (pinned): hydrated store path fires onTaskToggled twice when the settled value differs from the optimistic guess (reconciliation)', async () => {
    tasksByIdGetMock
      .mockReturnValueOnce({ 'item-1': { id: 'item-1', title: 'Task', courses: [], completed: false } }) // truthy check
      .mockReturnValueOnce({ 'item-1': { id: 'item-1', title: 'Task', courses: [], completed: false } }); // settled: server rejected the flip
    const { onTaskToggled } = renderPopover({ item: taskItem(false) });
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    await fireEvent.click(checkbox);
    await waitFor(() => expect(onTaskToggled).toHaveBeenCalledTimes(2));
    expect(onTaskToggled).toHaveBeenNthCalledWith(1, 'item-1', true); // optimistic
    expect(onTaskToggled).toHaveBeenNthCalledWith(2, 'item-1', false); // reconciled back
    expect(checkbox.checked).toBe(false);
  });

  it('BUG (pinned): the hydrated store path never fires an analytics event, even when checking a task (analytics only fires on the direct-PATCH fallback path)', async () => {
    tasksByIdGetMock.mockReturnValue({ 'item-1': { id: 'item-1', title: 'Task', courses: [], completed: true } });
    currentAnalyticsSurfaceMock.mockReturnValue('/planner');
    renderPopover({ item: taskItem(false) });
    await fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(toggleTaskMock).toHaveBeenCalled());
    expect(captureBehavioralEventMock).not.toHaveBeenCalled();
  });

  it('non-hydrated path fires the analytics event on check, only when a surface is set', async () => {
    currentAnalyticsSurfaceMock.mockReturnValue('/planner');
    apiFetchMock.mockResolvedValueOnce(ok({}));
    renderPopover({ item: taskItem(false) });
    await fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(captureBehavioralEventMock).toHaveBeenCalledTimes(1));
  });

  it('non-hydrated path does not fire analytics when no surface is set', async () => {
    currentAnalyticsSurfaceMock.mockReturnValue(undefined);
    apiFetchMock.mockResolvedValueOnce(ok({}));
    renderPopover({ item: taskItem(false) });
    await fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(captureBehavioralEventMock).not.toHaveBeenCalled();
  });

  it('does not fire analytics when unchecking (nextDone false)', async () => {
    currentAnalyticsSurfaceMock.mockReturnValue('/planner');
    apiFetchMock.mockResolvedValueOnce(ok({}));
    renderPopover({ item: taskItem(true) });
    await fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(captureBehavioralEventMock).not.toHaveBeenCalled();
  });

  it('celebrates (confetti + markFlowCelebration) only when checking, never when unchecking', async () => {
    apiFetchMock.mockResolvedValue(ok({}));
    const { unmount } = renderPopover({ item: taskItem(false) });
    await fireEvent.click(screen.getByRole('checkbox'));
    expect(burstConfettiMock).toHaveBeenCalledTimes(1);
    expect(markFlowCelebrationMock).toHaveBeenCalledTimes(1);
    unmount();

    burstConfettiMock.mockClear();
    markFlowCelebrationMock.mockClear();
    renderPopover({ item: taskItem(true) });
    await fireEvent.click(screen.getByRole('checkbox'));
    expect(burstConfettiMock).not.toHaveBeenCalled();
    expect(markFlowCelebrationMock).not.toHaveBeenCalled();
  });

  it('REENTRANCY (pinned, no guard beyond the disabled attribute): two rapid clicks before the DOM flushes fire two requests', async () => {
    apiFetchMock.mockResolvedValue(ok({}));
    renderPopover({ item: taskItem(false) });
    const checkbox = screen.getByRole('checkbox');
    const p1 = fireEvent.click(checkbox);
    const p2 = fireEvent.click(checkbox);
    await Promise.all([p1, p2]);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('nudgeSession — study_session reschedule', () => {
  function activeSession(overrides: Partial<CalendarItem> = {}) {
    return makeItem({
      type: 'study_session',
      date: '2026-08-20T15:00:00.000Z',
      end_date: '2026-08-20T16:00:00.000Z',
      details: { completed: false },
      ...overrides,
    });
  }

  it('success: shifts both date and end_date by the delta and reports the new values via onItemUpdated', async () => {
    apiFetchMock.mockResolvedValueOnce(ok({}));
    const { onItemUpdated } = renderPopover({ item: activeSession() });
    await fireEvent.click(screen.getByRole('button', { name: '−30 min' }));
    await waitFor(() => expect(onItemUpdated).toHaveBeenCalled());
    expect(onItemUpdated).toHaveBeenNthCalledWith(1, 'item-1', {
      date: '2026-08-20T14:30:00.000Z',
      end_date: '2026-08-20T15:30:00.000Z',
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/sessions/item-1',
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scheduled_at: '2026-08-20T14:30:00.000Z' }) },
      'Could not reschedule this session.',
    );
  });

  it('end_date: null stays null after the nudge — only date moves', async () => {
    apiFetchMock.mockResolvedValueOnce(ok({}));
    const { onItemUpdated } = renderPopover({ item: activeSession({ end_date: null }) });
    await fireEvent.click(screen.getByRole('button', { name: '+30 min' }));
    await waitFor(() => expect(onItemUpdated).toHaveBeenCalled());
    expect(onItemUpdated).toHaveBeenNthCalledWith(1, 'item-1', {
      date: '2026-08-20T15:30:00.000Z',
      end_date: null,
    });
  });

  it('HTTP failure: rolls back date/end_date via a second onItemUpdated call and shows the reschedule error', async () => {
    apiFetchMock.mockResolvedValueOnce(httpErr('Could not reschedule this session.'));
    const { onItemUpdated } = renderPopover({ item: activeSession() });
    await fireEvent.click(screen.getByRole('button', { name: '−30 min' }));
    await waitFor(() => expect(screen.getByText('Could not reschedule this session.')).toBeTruthy());
    expect(onItemUpdated).toHaveBeenCalledTimes(2);
    expect(onItemUpdated).toHaveBeenNthCalledWith(1, 'item-1', { date: '2026-08-20T14:30:00.000Z', end_date: '2026-08-20T15:30:00.000Z' });
    expect(onItemUpdated).toHaveBeenNthCalledWith(2, 'item-1', { date: '2026-08-20T15:00:00.000Z', end_date: '2026-08-20T16:00:00.000Z' });
  });

  it('network failure shows the generic message, distinct from the HTTP-failure text', async () => {
    apiFetchMock.mockResolvedValueOnce(networkErr());
    renderPopover({ item: activeSession() });
    await fireEvent.click(screen.getByRole('button', { name: '−30 min' }));
    await waitFor(() => expect(screen.getByText(NETWORK_ERROR_MESSAGE)).toBeTruthy());
    expect(screen.queryByText('Could not reschedule this session.')).toBeNull();
  });

  it('in-flight flag disables both nudge buttons during the request', async () => {
    const { promise, resolve } = deferred<ApiResult<unknown>>();
    apiFetchMock.mockReturnValueOnce(promise);
    renderPopover({ item: activeSession() });
    const minus = screen.getByRole('button', { name: '−30 min' }) as HTMLButtonElement;
    const plus = screen.getByRole('button', { name: '+30 min' }) as HTMLButtonElement;
    await fireEvent.click(minus);
    expect(minus.disabled).toBe(true);
    expect(plus.disabled).toBe(true);
    resolve(ok({}));
    await waitFor(() => expect(minus.disabled).toBe(false));
  });

  it('reschedule controls are hidden once the session is completed', () => {
    renderPopover({ item: activeSession({ details: { completed: true } }) });
    expect(screen.queryByRole('button', { name: '−30 min' })).toBeNull();
  });

  it('NO VALIDATION (pinned): two rapid −30 clicks before either request settles apply cumulative shifts with no bound check on date vs end_date', async () => {
    apiFetchMock.mockResolvedValue(ok({}));
    const { onItemUpdated } = renderPopover({ item: activeSession() });
    const minus = screen.getByRole('button', { name: '−30 min' });
    const p1 = fireEvent.click(minus);
    const p2 = fireEvent.click(minus);
    await Promise.all([p1, p2]);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    // Second call's synchronous prefix ran before the first awaited, so it
    // read the already-shifted (by the first call) item.date/end_date and
    // shifted again — a cumulative -60 min with nothing stopping it.
    const secondCallBody = JSON.parse((apiFetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(secondCallBody.scheduled_at).toBe('2026-08-20T14:00:00.000Z');
    expect(onItemUpdated).toHaveBeenCalledWith('item-1', { date: '2026-08-20T14:00:00.000Z', end_date: '2026-08-20T15:00:00.000Z' });
  });
});

describe('setClassStatus — class_session attendance', () => {
  function classItem(status: 'attended' | 'missed' | null = null) {
    return makeItem({ type: 'class_session', details: { status, note: null, source: 'seed', task_id: null, start_min: 540, end_min: 600 } });
  }

  it('success: marks attended, sends the current analytics surface as a header, reports the patch', async () => {
    currentAnalyticsSurfaceMock.mockReturnValue('/planner');
    apiFetchMock.mockResolvedValueOnce(ok({}));
    const { onItemUpdated } = renderPopover({ item: classItem(null) });
    await fireEvent.click(screen.getByRole('button', { name: /attended/i }));
    await waitFor(() => expect(onItemUpdated).toHaveBeenCalled());
    expect(onItemUpdated).toHaveBeenNthCalledWith(1, 'item-1', { details: { status: 'attended' } });
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/class-sessions/item-1',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'X-Studyus-Analytics-Surface': '/planner' },
        body: JSON.stringify({ status: 'attended' }),
      },
      'Could not update attendance.',
    );
  });

  it('reports the surface it is actually mounted on, not a hardcoded /planner', async () => {
    currentAnalyticsSurfaceMock.mockReturnValue('/dashboard'); // simulates the WeekView mounting context
    apiFetchMock.mockResolvedValueOnce(ok({}));
    renderPopover({ item: classItem(null), plannerLink: '/planner?event=item-1' });
    await fireEvent.click(screen.getByRole('button', { name: /missed/i }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const headers = (apiFetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Studyus-Analytics-Surface']).toBe('/dashboard');
  });

  it('omits the surface header entirely when no analytics surface is known', async () => {
    currentAnalyticsSurfaceMock.mockReturnValue(undefined);
    apiFetchMock.mockResolvedValueOnce(ok({}));
    renderPopover({ item: classItem(null) });
    await fireEvent.click(screen.getByRole('button', { name: /missed/i }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    const headers = (apiFetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers).toEqual({ 'content-type': 'application/json' });
  });

  it('no-op guard: clicking the already-active status does nothing (no request, no callback)', async () => {
    const { onItemUpdated } = renderPopover({ item: classItem('attended') });
    await fireEvent.click(screen.getByRole('button', { name: /attended/i }));
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(onItemUpdated).not.toHaveBeenCalled();
  });

  it('Clear button is absent with no status set, and present once a status is set', () => {
    renderPopover({ item: classItem(null) });
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
    cleanup();
    renderPopover({ item: classItem('attended') });
    expect(screen.getByRole('button', { name: /clear/i })).toBeTruthy();
  });

  it('clicking Clear sends status: null', async () => {
    currentAnalyticsSurfaceMock.mockReturnValue('/planner');
    apiFetchMock.mockResolvedValueOnce(ok({}));
    const { onItemUpdated } = renderPopover({ item: classItem('attended') });
    await fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(onItemUpdated).toHaveBeenCalled());
    expect(onItemUpdated).toHaveBeenNthCalledWith(1, 'item-1', { details: { status: null } });
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/class-sessions/item-1',
      { method: 'PATCH', headers: { 'content-type': 'application/json', 'X-Studyus-Analytics-Surface': '/planner' }, body: JSON.stringify({ status: null }) },
      'Could not update attendance.',
    );
  });

  it('HTTP failure: rolls back to the previous status via a second onItemUpdated call and shows the error', async () => {
    apiFetchMock.mockResolvedValueOnce(httpErr('Could not update attendance.'));
    const { onItemUpdated } = renderPopover({ item: classItem(null) });
    await fireEvent.click(screen.getByRole('button', { name: /missed/i }));
    await waitFor(() => expect(screen.getByText('Could not update attendance.')).toBeTruthy());
    expect(onItemUpdated).toHaveBeenNthCalledWith(1, 'item-1', { details: { status: 'missed' } });
    expect(onItemUpdated).toHaveBeenNthCalledWith(2, 'item-1', { details: { status: null } });
  });

  it('network failure shows the generic message, distinct from the HTTP-failure text', async () => {
    apiFetchMock.mockResolvedValueOnce(networkErr());
    renderPopover({ item: classItem(null) });
    await fireEvent.click(screen.getByRole('button', { name: /missed/i }));
    await waitFor(() => expect(screen.getByText(NETWORK_ERROR_MESSAGE)).toBeTruthy());
  });

  it('in-flight flag disables the attendance buttons during the request', async () => {
    const { promise, resolve } = deferred<ApiResult<unknown>>();
    apiFetchMock.mockReturnValueOnce(promise);
    renderPopover({ item: classItem(null) });
    const attendedBtn = screen.getByRole('button', { name: /attended/i }) as HTMLButtonElement;
    const missedBtn = screen.getByRole('button', { name: /missed/i }) as HTMLButtonElement;
    await fireEvent.click(attendedBtn);
    expect(attendedBtn.disabled).toBe(true);
    expect(missedBtn.disabled).toBe(true);
    resolve(ok({}));
    await waitFor(() => expect(attendedBtn.disabled).toBe(false));
  });

  it('REENTRANCY QUIRK (pinned): two rapid clicks on the SAME target status are incidentally caught by the no-op guard, because it mutates item.details in place synchronously before yielding', async () => {
    apiFetchMock.mockResolvedValue(ok({}));
    renderPopover({ item: classItem(null) });
    const missedBtn = screen.getByRole('button', { name: /missed/i });
    // Neither click awaits before the next fires, so both run their
    // synchronous prefix before either's `await apiFetch` resolves. The
    // first click's prefix mutates item.details.status to 'missed' in
    // place; the second click's prevStatus read then sees that already-
    // mutated value and matches `next`, so the no-op guard (not any
    // explicit reentrancy guard) blocks it. This is a side effect of the
    // mutate-then-await ordering, not a deliberate protection.
    const p1 = fireEvent.click(missedBtn);
    const p2 = fireEvent.click(missedBtn);
    await Promise.all([p1, p2]);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('REENTRANCY (pinned, no guard beyond the disabled attribute): two rapid clicks to DIFFERENT statuses before the DOM flushes both go through', async () => {
    apiFetchMock.mockResolvedValue(ok({}));
    renderPopover({ item: classItem(null) });
    const attendedBtn = screen.getByRole('button', { name: /attended/i });
    const missedBtn = screen.getByRole('button', { name: /missed/i });
    const p1 = fireEvent.click(attendedBtn);
    const p2 = fireEvent.click(missedBtn);
    await Promise.all([p1, p2]);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('saveNote — class_session note', () => {
  function classItemWithNote(note: string | null) {
    return makeItem({ type: 'class_session', details: { status: null, note, source: 'seed', task_id: null, start_min: 540, end_min: 600 } });
  }

  it('Save button starts disabled when the draft matches the saved note', () => {
    renderPopover({ item: classItemWithNote('existing note') });
    expect((screen.getByRole('button', { name: 'Save note' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('whitespace-only draft is sent as null, not as whitespace', async () => {
    apiFetchMock.mockResolvedValueOnce(ok({}));
    const { onItemUpdated } = renderPopover({ item: classItemWithNote('existing note') });
    const textarea = screen.getByLabelText('Note') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: '   ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(onItemUpdated).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/class-sessions/item-1',
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: null }) },
      'Could not save note.',
    );
    expect(onItemUpdated).toHaveBeenNthCalledWith(1, 'item-1', { details: { note: null } });
  });

  it('a non-empty draft is sent UNTRIMMED, including leading/trailing whitespace', async () => {
    apiFetchMock.mockResolvedValueOnce(ok({}));
    renderPopover({ item: classItemWithNote(null) });
    const textarea = screen.getByLabelText('Note') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: '  padded note  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/class-sessions/item-1',
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: '  padded note  ' }) },
      'Could not save note.',
    );
  });

  it('HTTP failure: rolls back the details.note via onItemUpdated and shows the error', async () => {
    apiFetchMock.mockResolvedValueOnce(httpErr('Could not save note.'));
    const { onItemUpdated } = renderPopover({ item: classItemWithNote('original') });
    const textarea = screen.getByLabelText('Note') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'edited' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.getByText('Could not save note.')).toBeTruthy());
    expect(onItemUpdated).toHaveBeenNthCalledWith(1, 'item-1', { details: { note: 'edited' } });
    expect(onItemUpdated).toHaveBeenNthCalledWith(2, 'item-1', { details: { note: 'original' } });
  });

  it('network failure shows the generic message, distinct from the HTTP-failure text', async () => {
    apiFetchMock.mockResolvedValueOnce(networkErr());
    renderPopover({ item: classItemWithNote('original') });
    const textarea = screen.getByLabelText('Note') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'edited' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.getByText(NETWORK_ERROR_MESSAGE)).toBeTruthy());
  });

  it('DATA LOSS (pinned): a failed save overwrites noteDraft with the rolled-back value, discarding whatever the user typed in the meantime', async () => {
    const { promise, resolve } = deferred<ApiResult<unknown>>();
    apiFetchMock.mockReturnValueOnce(promise);
    renderPopover({ item: classItemWithNote('original') });
    const textarea = screen.getByLabelText('Note') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'first edit' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    // User keeps typing while the request they no longer see feedback for is in flight.
    await fireEvent.input(textarea, { target: { value: 'first edit, plus more the user typed while saving' } });
    resolve(httpErr('Could not save note.'));
    await waitFor(() => expect(screen.getByText('Could not save note.')).toBeTruthy());
    // The in-flight edits are gone — overwritten by the rollback to the
    // pre-save value, not preserved.
    expect(textarea.value).toBe('original');
  });

  it('in-flight flag disables the Save button and changes its label', async () => {
    const { promise, resolve } = deferred<ApiResult<unknown>>();
    apiFetchMock.mockReturnValueOnce(promise);
    renderPopover({ item: classItemWithNote('original') });
    const textarea = screen.getByLabelText('Note') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'edited' } });
    const button = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    await fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Saving…');
    resolve(ok({}));
    await waitFor(() => expect(button.disabled).toBe(true)); // stays disabled: draft now equals saved note again, noteDirty is false
  });

  it('REENTRANCY (pinned, no guard beyond the disabled attribute): two rapid clicks before the DOM flushes fire two requests', async () => {
    apiFetchMock.mockResolvedValue(ok({}));
    renderPopover({ item: classItemWithNote('original') });
    const textarea = screen.getByLabelText('Note') as HTMLTextAreaElement;
    await fireEvent.input(textarea, { target: { value: 'edited' } });
    const button = screen.getByRole('button', { name: 'Save note' });
    const p1 = fireEvent.click(button);
    const p2 = fireEvent.click(button);
    await Promise.all([p1, p2]);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('dismiss (Escape / outside click) while a request is in flight', () => {
  function classItem() {
    return makeItem({ type: 'class_session', details: { status: null, note: null, source: 'seed', task_id: null, start_min: 540, end_min: 600 } });
  }

  it('Escape closes immediately; the in-flight request still resolves and still mutates parent state afterward', async () => {
    const { promise, resolve } = deferred<ApiResult<unknown>>();
    apiFetchMock.mockReturnValueOnce(promise);
    const { onClose, onItemUpdated } = renderPopover({ item: classItem() });
    await fireEvent.click(screen.getByRole('button', { name: /attended/i }));
    expect(onItemUpdated).toHaveBeenCalledTimes(1); // optimistic call already fired

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // The request is still pending — nothing about closing cancelled it.
    expect(onItemUpdated).toHaveBeenCalledTimes(1);

    resolve(ok({}));
    await waitFor(() => expect(screen.getByRole('button', { name: /attended/i })).toBeTruthy());
    // No second call because this resolved successfully (status matched the
    // optimistic value) — the point is the popover's own async work keeps
    // running with no "am I still open" check, not that this path double-fires.
    expect(onItemUpdated).toHaveBeenCalledTimes(1);
  });

  it('an HTTP failure after Escape still rolls back and calls onItemUpdated a second time post-close', async () => {
    const { promise, resolve } = deferred<ApiResult<unknown>>();
    apiFetchMock.mockReturnValueOnce(promise);
    const { onClose, onItemUpdated } = renderPopover({ item: classItem() });
    await fireEvent.click(screen.getByRole('button', { name: /attended/i }));
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    resolve(httpErr('Could not update attendance.'));
    await waitFor(() => expect(onItemUpdated).toHaveBeenCalledTimes(2));
    expect(onItemUpdated).toHaveBeenNthCalledWith(2, 'item-1', { details: { status: null } });
  });

  it('an outside pointerdown closes immediately while a request is in flight, same as Escape', async () => {
    const { promise, resolve } = deferred<ApiResult<unknown>>();
    apiFetchMock.mockReturnValueOnce(promise);
    const { onClose, onItemUpdated } = renderPopover({ item: classItem() });
    await fireEvent.click(screen.getByRole('button', { name: /attended/i }));

    await fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onItemUpdated).toHaveBeenCalledTimes(1);

    resolve(ok({}));
    await waitFor(() => expect(screen.getByRole('button', { name: /attended/i })).toBeTruthy());
  });
});
