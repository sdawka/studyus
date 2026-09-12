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
    await fireEvent.click(within(recommended).getByRole('button', { name: 'I need support' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ type: 'retrieval_practice', experience_id: experience.id, kc_id: experience.evidence!.target_kc_ids[0], payload: { correct: false } });
  });
});
