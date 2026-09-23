import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CourseModules from '../../src/components/course/CourseModules.svelte';
import { loadDefaultCourse } from '../../src/lib/content/defaultCourse';

afterEach(() => {
  window.location.hash = '';
});

function activity(container: HTMLElement, experienceId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`#experience-${experienceId}`);
  if (!element) throw new Error(`Missing activity ${experienceId}`);
  return element;
}

describe('CourseModules', () => {
  it('renders runnable content and records evidence through the event API', async () => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const experience = draft.experiences.find((row) => row.evidence)!;
    render(CourseModules, { courseId: 'course-id', draft, recommendedExperienceId: experience.id });
    expect(screen.getByText('Recommended next')).toBeTruthy();
    const recommended = screen.getByText('Recommended next').closest<HTMLElement>('article');
    if (!recommended) throw new Error('Expected recommended activity');
    await fireEvent.input(within(recommended).getByLabelText('Your response'), { target: { value: 'My retrieval plan' } });
    await fireEvent.click(within(recommended).getByRole('button', { name: 'Save response' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/experiences/${experience.id}/respond`);
    expect(JSON.parse(String(init.body))).toEqual({ response: 'My retrieval plan' });
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps selected-response answers hidden and submits only the learner selection', async () => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const experience = draft.experiences.find((row) => row.evidence)!;
    experience.evidence!.response_type = 'selected_response';
    experience.evidence!.scoring = { kind: 'binary', details: { schema_version: 1, correct_response: 1 } };
    experience.content = {
      schema_version: 1,
      kind: 'mcq',
      prompt: 'Which practice tests recall?',
      options: ['Rereading', 'Retrieval'],
      correct_index: 1,
      explanation: 'Retrieval tests access without the answer visible.',
    };

    render(CourseModules, { courseId: 'course-id', draft });
    expect(screen.queryByText('Retrieval tests access without the answer visible.')).toBeNull();
    const select = screen.getByLabelText('Choose an answer');
    if (!(select instanceof HTMLSelectElement)) throw new Error('Expected answer select');
    select.selectedIndex = 2;
    await fireEvent.change(select);
    const article = select.closest<HTMLElement>('article');
    if (!article) throw new Error('Expected answer activity');
    const submit = within(article).getByRole('button', { name: 'Save response' }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    await fireEvent.click(submit);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(String((fetch.mock.calls[0][1] as RequestInit).body))).toEqual({ selected_index: 1 });
  });

  it('submits accepted numeric evidence through a numeric response control', async () => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const experience = draft.experiences.find((row) => row.evidence)!;
    experience.evidence!.response_type = 'constructed_response';
    experience.evidence!.scoring = { kind: 'numeric', details: { schema_version: 1, answer: { value: 42, tolerance_pct: 0 } } };
    experience.content = { schema_version: 1, kind: 'numeric', prompt: 'What is six times seven?', answer: { value: 42, unit: null, tolerance_pct: 0 }, solution: '42' };
    render(CourseModules, { courseId: 'course-id', draft });
    const input = screen.getByRole('spinbutton', { name: 'Your response' });
    await fireEvent.input(input, { target: { value: '42' } });
    const article = input.closest<HTMLElement>('article');
    if (!article) throw new Error('Expected numeric activity');
    await fireEvent.click(within(article).getByRole('button', { name: 'Save response' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(String((fetch.mock.calls[0][1] as RequestInit).body))).toEqual({ response: '42' });
  });

  it('offers Continue after saving and focuses the next activity', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const current = draft.experiences.find((row) => row.id === draft.modules[0].experience_ids[0])!;
    const next = draft.experiences.find((row) => row.id === draft.modules[0].experience_ids[1])!;
    const { container } = render(CourseModules, { courseId: 'course-id', draft });
    const currentArticle = activity(container, current.id);

    await fireEvent.click(within(currentArticle).getByRole('button', { name: 'Mark explanation read' }));
    await waitFor(() => expect(within(currentArticle).getByRole('status').textContent).toContain('Reading recorded.'));
    await fireEvent.click(within(currentArticle).getByRole('button', { name: /^Continue to / }));

    await waitFor(() => expect(document.activeElement).toBe(container.querySelector(`#experience-${next.id}`)));
    expect(window.location.hash).toBe(`#experience-${next.id}`);
  });

  it('continues across a module boundary and opens the next module', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const current = draft.experiences.find((row) => row.id === draft.modules[0].experience_ids[1])!;
    const next = draft.experiences.find((row) => row.id === draft.modules[1].experience_ids[0])!;
    const { container } = render(CourseModules, { courseId: 'course-id', draft });
    const currentArticle = activity(container, current.id);

    await fireEvent.input(within(currentArticle).getByLabelText('Your response'), { target: { value: 'A learner retrieval plan' } });
    await fireEvent.click(within(currentArticle).getByRole('button', { name: 'Save response' }));
    await fireEvent.click(await screen.findByRole('button', { name: /^Continue to / }));

    await waitFor(() => expect(container.querySelector(`#experience-${next.id}`)?.closest('details')?.open).toBe(true));
    expect(document.activeElement).toBe(container.querySelector(`#experience-${next.id}`));
  });

  it('uses placement IDs for reused activities and continues from the later placement', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const shared = draft.experiences.find((row) => row.id === draft.modules[0].experience_ids[0])!;
    const secondModule = draft.modules[1];
    const following = draft.experiences.find((row) => row.id === secondModule.experience_ids[0])!;
    secondModule.experience_ids = [shared.id, following.id];
    const laterPlacementId = `module-${secondModule.id}-experience-${shared.id}`;
    const { container } = render(CourseModules, { courseId: 'course-id', draft, recommendedExperienceId: shared.id });
    const sharedActivities = container.querySelectorAll(`[id$="experience-${shared.id}"]`);
    expect(container.querySelectorAll('article.recommended')).toHaveLength(1);
    expect(container.querySelector('article.recommended')?.id).toBe(`experience-${shared.id}`);
    expect(screen.getAllByText('Recommended next')).toHaveLength(1);

    expect([...sharedActivities].map((element) => element.id)).toEqual([
      `experience-${shared.id}`,
      laterPlacementId,
    ]);

    const laterActivity = container.querySelector<HTMLElement>(`#${laterPlacementId}`);
    if (!laterActivity) throw new Error('Expected later shared activity placement');
    await fireEvent.click(within(laterActivity).getByRole('button', { name: 'Mark explanation read' }));
    await fireEvent.click(await within(laterActivity).findByRole('button', { name: /^Continue to / }));

    await waitFor(() => expect(document.activeElement).toBe(container.querySelector(`#experience-${following.id}`)));
    expect(container.querySelector(`#experience-${following.id}`)?.closest('details')?.open).toBe(true);
    expect(window.location.hash).toBe(`#experience-${following.id}`);
  });

  it('keeps a failed response for retry and reuses its idempotency key', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Response was not accepted yet.' } }), { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const current = draft.experiences.find((row) => row.evidence)!;
    const { container } = render(CourseModules, { courseId: 'course-id', draft });
    const currentArticle = activity(container, current.id);
    const answer = within(currentArticle).getByLabelText('Your response') as HTMLTextAreaElement;

    await fireEvent.input(answer, { target: { value: 'Keep this answer' } });
    await fireEvent.click(within(currentArticle).getByRole('button', { name: 'Save response' }));
    await waitFor(() => expect(within(currentArticle).getByRole('status').textContent).toContain('Response was not accepted yet.'));
    expect(answer.value).toBe('Keep this answer');
    await fireEvent.click(within(currentArticle).getByRole('button', { name: 'Save response' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const first = fetch.mock.calls[0][1] as RequestInit;
    const retry = fetch.mock.calls[1][1] as RequestInit;
    expect((retry.headers as Record<string, string>)['Idempotency-Key']).toBe((first.headers as Record<string, string>)['Idempotency-Key']);
  });

  it('uses a new idempotency key when an edited failed response changes the payload', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Try again.' } }), { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const current = draft.experiences.find((row) => row.evidence)!;
    const { container } = render(CourseModules, { courseId: 'course-id', draft });
    const currentArticle = activity(container, current.id);
    const answer = within(currentArticle).getByLabelText('Your response');

    await fireEvent.input(answer, { target: { value: 'First answer' } });
    await fireEvent.click(within(currentArticle).getByRole('button', { name: 'Save response' }));
    await waitFor(() => expect(within(currentArticle).getByRole('status').textContent).toContain('Try again.'));
    await fireEvent.input(answer, { target: { value: 'Edited answer' } });
    await fireEvent.click(within(currentArticle).getByRole('button', { name: 'Save response' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    const first = fetch.mock.calls[0][1] as RequestInit;
    const retry = fetch.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(retry.body))).toEqual({ response: 'Edited answer' });
    expect((retry.headers as Record<string, string>)['Idempotency-Key']).not.toBe((first.headers as Record<string, string>)['Idempotency-Key']);
  });

  it('does not submit the same activity twice while its response is pending', async () => {
    let resolveResponse!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const current = draft.experiences.find((row) => !row.evidence)!;
    const { container } = render(CourseModules, { courseId: 'course-id', draft });
    const submit = within(activity(container, current.id)).getByRole('button', { name: 'Mark explanation read' });

    await fireEvent.click(submit);
    await fireEvent.click(submit);
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveResponse(new Response(JSON.stringify({ data: {} }), { status: 201 }));
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  });

  it('removes a prior Continue action when a changed response fails to save', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Try that revision again.' } }), { status: 422 }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const current = draft.experiences.find((row) => row.evidence)!;
    const { container } = render(CourseModules, { courseId: 'course-id', draft });
    const currentArticle = activity(container, current.id);
    const answer = within(currentArticle).getByLabelText('Your response');

    await fireEvent.input(answer, { target: { value: 'First answer' } });
    await fireEvent.click(within(currentArticle).getByRole('button', { name: 'Save response' }));
    await screen.findByRole('button', { name: /^Continue to / });
    await fireEvent.input(answer, { target: { value: 'Changed answer' } });
    expect(within(currentArticle).queryByRole('button', { name: /^Continue to / })).toBeNull();
    await fireEvent.click(within(currentArticle).getByRole('button', { name: 'Save response' }));

    await waitFor(() => expect(within(currentArticle).getByRole('status').textContent).toContain('Try that revision again.'));
    expect(within(currentArticle).queryByRole('button', { name: /^Continue to / })).toBeNull();
  });

  it('labels the final activity as the last activity rather than a completed pass', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const final = draft.experiences.find((row) => row.id === draft.modules.at(-1)!.experience_ids.at(-1))!;
    const { container } = render(CourseModules, { courseId: 'course-id', draft });
    const finalArticle = activity(container, final.id);

    await fireEvent.input(within(finalArticle).getByLabelText('Your response'), { target: { value: 'Review and adapt' } });
    await fireEvent.click(within(finalArticle).getByRole('button', { name: 'Save response' }));

    await waitFor(() => expect(within(finalArticle).getAllByRole('status').some((status) => status.textContent?.includes('You’ve reached the last activity'))).toBe(true));
    const review = within(finalArticle).getByRole('button', { name: 'Review course modules' });
    const heading = container.querySelector<HTMLElement>('#course-modules-heading');
    if (!heading) throw new Error('Expected course modules heading');
    const scrollIntoView = vi.fn();
    Object.defineProperty(heading, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    await fireEvent.click(review);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(document.activeElement).toBe(heading);
    expect(within(finalArticle).getAllByRole('status').some((status) => status.textContent?.includes('Response saved.'))).toBe(true);
  });

  it('opens and focuses the activity named by the initial hash', async () => {
    const draft = loadDefaultCourse();
    const target = draft.experiences.find((row) => row.id === draft.modules[1].experience_ids[0])!;
    window.location.hash = `experience-${target.id}`;
    const { container } = render(CourseModules, { courseId: 'course-id', draft });

    await waitFor(() => expect(document.activeElement).toBe(container.querySelector(`#experience-${target.id}`)));
    expect(container.querySelector(`#experience-${target.id}`)?.closest('details')?.open).toBe(true);
  });

  it('restores a reused activity from its module-qualified placement hash', async () => {
    const draft = loadDefaultCourse();
    const shared = draft.experiences.find((row) => row.id === draft.modules[0].experience_ids[0])!;
    const secondModule = draft.modules[1];
    secondModule.experience_ids = [shared.id, ...secondModule.experience_ids];
    const placementId = `module-${secondModule.id}-experience-${shared.id}`;
    window.location.hash = placementId;

    const { container } = render(CourseModules, { courseId: 'course-id', draft });

    await waitFor(() => expect(document.activeElement).toBe(container.querySelector(`#${placementId}`)));
    expect(container.querySelector(`#${placementId}`)?.closest('details')?.open).toBe(true);
  });

  it('ignores a malformed activity hash without throwing', () => {
    window.location.hash = 'experience-%';
    expect(() => render(CourseModules, { courseId: 'course-id', draft: loadDefaultCourse() })).not.toThrow();
  });
});
