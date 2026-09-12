import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CourseModules from '../../src/components/course/CourseModules.svelte';
import { loadDefaultCourse } from '../../src/lib/content/defaultCourse';

describe('CourseModules', () => {
  it('renders runnable content and records evidence through the event API', async () => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => new Response(JSON.stringify({ data: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const draft = loadDefaultCourse();
    const experience = draft.experiences.find((row) => row.evidence)!;
    render(CourseModules, { courseId: 'course-id', draft, recommendedExperienceId: experience.id });
    expect(screen.getByText('Recommended next')).toBeTruthy();
    const recommended = screen.getByText('Recommended next').closest('article')!;
    await fireEvent.input(within(recommended).getByLabelText('Your response'), { target: { value: 'My retrieval plan' } });
    await fireEvent.click(within(recommended).getByRole('button', { name: 'Save response' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/experiences/${experience.id}/respond`);
    expect(JSON.parse(String(init.body))).toEqual({ response: 'My retrieval plan' });
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
    const submit = within(select.closest('article')!).getByRole('button', { name: 'Save response' }) as HTMLButtonElement;
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
    await fireEvent.click(within(input.closest('article')!).getByRole('button', { name: 'Save response' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(String((fetch.mock.calls[0][1] as RequestInit).body))).toEqual({ response: '42' });
  });
});
