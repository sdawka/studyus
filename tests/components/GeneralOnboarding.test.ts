import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingSetup from '../../src/components/onboarding/OnboardingSetup.svelte';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    data: { complete: true, course_slug: 'learning-how-to-learn' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

describe('general onboarding', () => {
  it('starts from the provided learning course and speaks in topic, level, and outcome language', () => {
    render(OnboardingSetup);

    expect(screen.getByRole('heading', { name: /Learning How to Learn/i })).toBeTruthy();
    expect(screen.getByText(/How do you know you.ve learned something/i)).toBeTruthy();
    expect(screen.getByLabelText(/Topic/i)).toBeTruthy();
    expect(screen.getByLabelText(/Level/i)).toBeTruthy();
    expect(screen.getByLabelText(/Learning outcome/i)).toBeTruthy();
  });

  it('keeps academic scheduling behind an optional disclosure', async () => {
    render(OnboardingSetup);

    const institution = screen.getByLabelText(/Institution/i);
    expect((institution.closest('details') as HTMLDetailsElement).open).toBe(false);
    await fireEvent.click(screen.getByText(/Add academic context/i));
    expect((institution.closest('details') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByLabelText(/Term name/i)).toBeTruthy();
  });

  it('keeps Skip as a native button on every step', async () => {
    render(OnboardingSetup);

    expect((screen.getByRole('button', { name: /Skip/i }) as HTMLButtonElement).type).toBe('button');
    await fireEvent.input(screen.getByLabelText(/Topic/i), { target: { value: 'Documentary filmmaking' } });
    await fireEvent.input(screen.getByLabelText(/Level/i), { target: { value: 'First project' } });
    await fireEvent.input(screen.getByLabelText(/Learning outcome/i), { target: { value: 'Shoot a short documentary' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Shape course' }));
    expect((screen.getByRole('button', { name: /Skip/i }) as HTMLButtonElement).type).toBe('button');
    await fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect((screen.getByRole('button', { name: /Skip/i }) as HTMLButtonElement).type).toBe('button');

    await fireEvent.click(screen.getByRole('button', { name: /Skip/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });
});
