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

  it('edits the parent draft and adds records without cloning Svelte proxy state', async () => {
    render(OnboardingSetup);
    await fireEvent.input(screen.getByLabelText(/Topic/i), { target: { value: 'Documentary filmmaking' } });
    await fireEvent.input(screen.getByLabelText(/Level/i), { target: { value: 'First project' } });
    await fireEvent.input(screen.getByLabelText(/Learning outcome/i), { target: { value: 'Shoot a short documentary' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Shape course' }));

    await fireEvent.input(screen.getByLabelText(/Learning outcome/i), { target: { value: 'Edit a coherent short documentary' } });
    await fireEvent.click(screen.getByRole('button', { name: /Add idea or skill/i }));
    await fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.getByText('2', { selector: 'dd' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText(/Learning outcome/i) as HTMLInputElement).value).toBe('Edit a coherent short documentary');
  });

  it('discards partial academic context when Skip is chosen', async () => {
    render(OnboardingSetup);
    await fireEvent.click(screen.getByText(/Add academic context/i));
    await fireEvent.input(screen.getByLabelText(/Institution/i), { target: { value: 'A partial school' } });

    await fireEvent.click(screen.getByRole('button', { name: /Skip/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const init = (vi.mocked(fetch).mock.calls[0]?.[1] ?? {}) as RequestInit;
    expect(JSON.parse(String(init.body))).not.toHaveProperty('context');
  });
});
