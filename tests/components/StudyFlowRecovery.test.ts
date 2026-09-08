import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/apiClient', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../src/lib/apiClient';
import StudyFlow from '../../src/components/study/StudyFlow.svelte';

const apiFetchMock = vi.mocked(apiFetch);
let resolvePause: ((value: { ok: false; error: string; reason: 'http' }) => void) | undefined;
let pauseAttempts = 0;
let timerCalls = 0;

beforeEach(() => {
  pauseAttempts = 0;
  timerCalls = 0;
  resolvePause = undefined;
  localStorage.clear();
  sessionStorage.clear();
  apiFetchMock.mockImplementation((path, init) => {
    if (path.endsWith('/timer')) {
      timerCalls += 1;
      if (timerCalls === 1) return Promise.resolve({ ok: true, data: { state: 'running', elapsed_ms: 0, sequence: 0, revision: 1, lease_token: 'lease' } });
      {
        pauseAttempts += 1;
        if (pauseAttempts === 1) return new Promise((resolve) => { resolvePause = resolve; });
        return Promise.resolve({ ok: true, data: { state: 'paused', elapsed_ms: 0, sequence: 1, revision: 2 } });
      }
    }
    if (path === '/api/v1/courses/history') return Promise.resolve({ ok: true, data: { branches: [] } });
    throw new Error(`Unexpected request ${path}`);
  });
});

describe('StudyFlow pause recovery', () => {
  it('keeps the running view while a failed pause settles, then retries into reflection', async () => {
    render(StudyFlow, { props: {
      courses: [{ id: 'course-1', slug: 'history', code: 'HIST101', title: 'History', mastery: null, status: null }],
      openSession: { id: 'session-1', courseId: 'course-1', courseCode: 'HIST101', intendedEventType: 'practice_done', plannedMinutes: 25, startedAt: Date.now(), timing: { state: 'paused', elapsedMs: 0, updatedAt: Date.now() } },
    } });
    await fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await screen.findByRole('button', { name: 'End session' });
    await fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(screen.queryByRole('heading', { name: 'Wrap up' })).toBeNull();
    expect(screen.getByRole('button', { name: 'End session' })).toBeTruthy();
    resolvePause?.({ ok: false, error: 'Timer server unavailable', reason: 'http' });
    await screen.findByText('Timer server unavailable');
    expect(screen.queryByRole('heading', { name: 'Wrap up' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Wrap up' })).toBeTruthy());
    expect(pauseAttempts).toBe(2);
  });
});
