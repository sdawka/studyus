import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingSetup from '../../src/components/onboarding/OnboardingSetup.svelte';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    data: { complete: true, course_slug: 'learning-how-to-learn' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

async function shapeADraft() {
  await fireEvent.input(screen.getByLabelText(/Topic/i), { target: { value: 'Documentary filmmaking' } });
  await fireEvent.input(screen.getByLabelText(/Level/i), { target: { value: 'First project' } });
  await fireEvent.input(screen.getByLabelText(/Learning outcome/i), { target: { value: 'Shoot a short documentary' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Shape course' }));
}

describe('general onboarding', () => {
  it('starts from the provided learning course and speaks in topic, level, and outcome language', () => {
    render(OnboardingSetup);

    expect(screen.getByRole('heading', { name: /Learning How to Learn/i })).toBeTruthy();
    expect(screen.getByText(/What proves you.ve actually learned it/i)).toBeTruthy();
    expect(screen.getByLabelText(/Topic/i)).toBeTruthy();
    expect(screen.getByLabelText(/Level/i)).toBeTruthy();
    expect(screen.getByLabelText(/Learning outcome/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Learning How to Learn' })).toBeTruthy();
  });

  it('keeps academic scheduling behind an optional disclosure on the authoring steps', async () => {
    render(OnboardingSetup);
    await shapeADraft();

    const institution = screen.getByLabelText(/Institution/i);
    expect((institution.closest('details') as HTMLDetailsElement).open).toBe(false);
    await fireEvent.click(screen.getByText(/Add a term and institution/i));
    expect((institution.closest('details') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByLabelText(/Term name/i)).toBeTruthy();
  });

  it('shows a two-item stepper with aria-current on the authoring screens only', async () => {
    const { container } = render(OnboardingSetup);
    expect(screen.queryByRole('list', { name: /New course: two steps/i })).toBeNull();

    await shapeADraft();
    const currentAfterShape = container.querySelector('li[aria-current="step"]');
    expect(currentAfterShape?.textContent).toMatch(/Shape/);

    await fireEvent.click(screen.getByRole('button', { name: 'Review and finish' }));
    const currentAfterReview = container.querySelector('li[aria-current="step"]');
    expect(currentAfterReview?.textContent).toMatch(/Review/);
  });

  it('keeps Skip as a native button on every step', async () => {
    render(OnboardingSetup);

    expect((screen.getByRole('button', { name: /Skip to Learning How to Learn/i }) as HTMLButtonElement).type).toBe('button');
    await shapeADraft();
    expect((screen.getByRole('button', { name: /Skip to Learning How to Learn/i }) as HTMLButtonElement).type).toBe('button');
    await fireEvent.click(screen.getByRole('button', { name: 'Review and finish' }));
    expect((screen.getByRole('button', { name: /Skip to Learning How to Learn/i }) as HTMLButtonElement).type).toBe('button');

    await fireEvent.click(screen.getByRole('button', { name: /Skip to Learning How to Learn/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it('shows the distinct in-flight status text for Skip and does not reuse the Finish label', async () => {
    render(OnboardingSetup);
    const statusRegion = screen.getByRole('status');
    expect(statusRegion.textContent).toBe('');

    await fireEvent.click(screen.getByRole('button', { name: /Skip to Learning How to Learn/i }));
    expect(screen.getAllByRole('button', { name: 'Opening Learning How to Learn…' }).length).toBeGreaterThan(0);
    expect(statusRegion.textContent).toMatch(/Marking setup done and opening Learning How to Learn/);
  });

  it('shows the distinct in-flight status text for Finish', async () => {
    render(OnboardingSetup);
    await shapeADraft();
    await fireEvent.click(screen.getByRole('button', { name: 'Review and finish' }));

    const statusRegion = screen.getByRole('status');
    await fireEvent.click(screen.getByRole('button', { name: 'Finish and open course' }));
    expect(screen.getByRole('button', { name: /Creating Documentary filmmaking…/ })).toBeTruthy();
    expect(statusRegion.textContent).toMatch(/Creating your course and marking setup done/);
  });

  it('edits the parent draft and adds records without cloning Svelte proxy state', async () => {
    render(OnboardingSetup);
    await shapeADraft();

    await fireEvent.input(screen.getByLabelText(/Learning outcome/i), { target: { value: 'Edit a coherent short documentary' } });
    await fireEvent.click(screen.getByRole('button', { name: /Add idea or skill/i }));
    await fireEvent.click(screen.getByRole('button', { name: 'Review and finish' }));

    expect(screen.getByText('2', { selector: 'dd' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText(/Learning outcome/i) as HTMLInputElement).value).toBe('Edit a coherent short documentary');
  });

  it('states what will be created, where it lands, and that Learning How to Learn stays, on review', async () => {
    render(OnboardingSetup);
    await shapeADraft();
    await fireEvent.click(screen.getByRole('button', { name: 'Review and finish' }));

    expect(screen.getByText(/Finishing creates this course in your account and opens it\. Learning How to Learn stays in your account too\./)).toBeTruthy();
    expect(screen.getByText('None. This course is not tied to a term.', { selector: 'dd' })).toBeTruthy();
  });

  it('discards partial academic context when Skip is chosen', async () => {
    render(OnboardingSetup);
    await shapeADraft();
    await fireEvent.click(screen.getByText(/Add a term and institution/i));
    await fireEvent.input(screen.getByLabelText(/Institution/i), { target: { value: 'A partial school' } });

    await fireEvent.click(screen.getByRole('button', { name: /Skip to Learning How to Learn/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const init = (vi.mocked(fetch).mock.calls[0]?.[1] ?? {}) as RequestInit;
    expect(JSON.parse(String(init.body))).not.toHaveProperty('context');
  });

  it('shows the trial banner from ?import=demo and dismisses it with Got it', async () => {
    const originalUrl = location.href;
    window.history.replaceState(null, '', '/onboarding?import=demo');
    try {
      render(OnboardingSetup);
      const banner = await screen.findByRole('region', { name: /About your trial/i });
      expect(banner.textContent).toMatch(/Trial practice and scores stay in the browser/);

      await fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
      expect(screen.queryByRole('region', { name: /About your trial/i })).toBeNull();
    } finally {
      window.history.replaceState(null, '', originalUrl);
    }
  });

  it('renders an alert for a failed Skip on step 2, and Back clears it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'Authentication required' },
    }), { status: 401, headers: { 'Content-Type': 'application/json' } })));
    render(OnboardingSetup);
    await shapeADraft();

    await fireEvent.click(screen.getByRole('button', { name: /Skip to Learning How to Learn/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Your session ended\. Sign in again to finish setup\./);

    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps step 2 edits when the learner goes back to step 1 and shapes again', async () => {
    render(OnboardingSetup);
    await shapeADraft();
    await fireEvent.click(screen.getByRole('button', { name: /Add idea or skill/i }));

    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.input(screen.getByLabelText(/Topic/i), { target: { value: 'Documentary editing' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Shape course' }));

    expect(screen.getByRole('heading', { name: 'Documentary editing' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Review and finish' }));
    expect(screen.getByText('2', { selector: 'dd' })).toBeTruthy();
  });

  it('tells the truth about an incomplete term on the review step', async () => {
    render(OnboardingSetup);
    await shapeADraft();
    await fireEvent.click(screen.getByText(/Add a term and institution/i));
    await fireEvent.input(screen.getByLabelText(/Institution/i), { target: { value: 'A partial school' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Review and finish' }));

    expect(screen.getByText(/Incomplete\. Fill in institution, term name, and both dates/)).toBeTruthy();
    expect(screen.queryByText(/None\. This course is not tied to a term/)).toBeNull();
  });
});
