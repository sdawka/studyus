import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PublicTrial from '../../src/components/demo/PublicTrial.svelte';

vi.mock('../../src/lib/analytics/demo', () => ({
  trackDemoFunnelEvent: vi.fn().mockResolvedValue(undefined),
  trackDemoFunnelEvents: vi.fn().mockResolvedValue(undefined),
}));

describe('grounded public trial preview', () => {
  beforeEach(() => {
    localStorage.removeItem('studyus:demo:v1');
  });

  it('uses a manual topic in the local recommendation and schedule', async () => {
    render(PublicTrial);

    await fireEvent.click(screen.getByRole('button', { name: 'Use my courses' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await fireEvent.input(screen.getByRole('textbox', { name: 'Course code' }), { target: { value: 'AUDIT 101' } });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Course title' }), { target: { value: 'Evidence literacy' } });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Course topics' }), { target: { value: 'Source tracing\nLong-form reasoning' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Use this course map' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Open my preview' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose my one priority' })).not.toBeNull());
    await fireEvent.click(screen.getByRole('button', { name: 'Choose my one priority' }));

    expect(screen.getByRole('heading', { name: 'Source tracing' })).not.toBeNull();
    expect(screen.getAllByText(/Nothing was added to a calendar/)).toHaveLength(2);
    expect(screen.getByText(/Capacity preview/)).not.toBeNull();
    expect(screen.getByText(/sessions? fit the supplied capacity/)).not.toBeNull();
    expect(screen.queryByText('Three focused sessions placed for you.')).toBeNull();
    expect(screen.queryByText(/Bernoulli equation moved/)).toBeNull();
    expect(screen.queryByText(/course standing/)).toBeNull();
  });
});
