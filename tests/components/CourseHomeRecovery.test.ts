import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../../src/lib/apiClient', () => ({ apiFetch: apiFetchMock }));

import CourseHome from '../../src/components/course/CourseHome.svelte';

const props = {
  courseId: 'course-1',
  courseSlug: 'math',
  courseCode: 'MATH 101',
  courseHue: 220,
  meetingDays: null,
  overview: null,
  branches: [],
  initialTasks: [],
};

function successFor(path: string) {
  if (path.includes('/assessments')) return { ok: true, data: [] };
  if (path.includes('/grades/summary')) return { ok: true, data: { by_course: [] } };
  return { ok: true, data: [] };
}

describe('CourseHome recovery', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('shows a retry after a failed reference load and prevents overlapping retries', async () => {
    let courseCalls = 0;
    let releaseRetry!: () => void;
    const retryReleased = new Promise<void>((resolve) => (releaseRetry = resolve));

    apiFetchMock.mockImplementation(async (path: string | undefined) => {
      if (!path) return { ok: true, data: [] };
      const isCourseReference = path.includes('/assessments') || path.includes('/grades/summary') || path.includes('/events?course=');
      if (!isCourseReference) return successFor(path);
      courseCalls += 1;
      if (courseCalls <= 3) {
        return { ok: false, error: 'failed', reason: 'network' };
      }
      await retryReleased;
      return successFor(path);
    });

    render(CourseHome, props);
    expect(await screen.findAllByText('Could not load course data.')).toHaveLength(4);

    const retry = screen.getByRole('button', { name: 'Try again' });
    await fireEvent.click(retry);
    await fireEvent.click(retry);

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(courseCalls).toBe(6);
    expect(screen.queryByText('No dated assessments ahead.')).toBeNull();
    releaseRetry();

    await waitFor(() => expect(screen.getByText('No dated assessments ahead.')).toBeTruthy());
    expect(screen.getByText('No events logged for this course yet.')).toBeTruthy();
    expect(screen.queryByText('Could not load course data.')).toBeNull();
  });
});
