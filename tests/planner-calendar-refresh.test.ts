import { describe, expect, it, vi } from 'vitest';
import { listenForCalendarSync } from '../src/lib/plannerCalendarRefresh';

describe('planner calendar refresh events', () => {
  it('refreshes when an activity-driven calendar sync completes', () => {
    const target = new EventTarget();
    const refresh = vi.fn();
    const stop = listenForCalendarSync(target, refresh);

    target.dispatchEvent(new Event('studyus:calendar-synced'));

    expect(refresh).toHaveBeenCalledOnce();
    stop();
  });

  it('removes the listener when the planner unmounts', () => {
    const target = new EventTarget();
    const refresh = vi.fn();
    const stop = listenForCalendarSync(target, refresh);

    stop();
    target.dispatchEvent(new Event('studyus:calendar-synced'));

    expect(refresh).not.toHaveBeenCalled();
  });
});
