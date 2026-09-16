// Regression guard for the concepts-tab hydration crash.
//
// `CourseDomainEditor` cloned its `initialDraft` prop with `structuredClone`.
// On the server that prop is a plain object, so SSR rendered fine; on the
// client Svelte 5 hands `$props()` back as a reactive proxy, and
// structuredClone throws DataCloneError on proxies. Hydration died, astro-island
// tore the island down, and the Concepts tab rendered an empty page while the
// Worker still logged 200 OK.
//
// Mounting the component here runs the client-side path, which is where the
// crash lived. No test mounted this component before, which is how it shipped.
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import CourseDomainEditor from '../../src/components/course/CourseDomainEditor.svelte';
import { loadDefaultCourse } from '../../src/lib/content/defaultCourse';

describe('CourseDomainEditor', () => {
  it('mounts against the real starter course without a clone error', () => {
    const initialDraft = loadDefaultCourse();

    expect(() => render(CourseDomainEditor, {
      courseId: 'course-id',
      initialDraft,
      initialRevision: 0,
    })).not.toThrow();

    // Content outside CourseMapReview — proves the editor itself mounted,
    // not merely that its child rendered.
    expect(screen.getByRole('button', { name: 'Save course' })).toBeTruthy();
    // Content inside CourseMapReview — proves the draft survived the clone.
    expect(screen.getByText('Outcomes')).toBeTruthy();
  });

  it('keeps the editor working when the draft arrives as a reactive proxy', () => {
    // Mirrors what `$props()` delivers on the client: a proxied object.
    // `structuredClone` on this throws DataCloneError; `$state.snapshot` does not.
    const proxiedDraft = new Proxy(loadDefaultCourse(), {});

    expect(() => render(CourseDomainEditor, {
      courseId: 'course-id',
      initialDraft: proxiedDraft,
      initialRevision: 0,
    })).not.toThrow();

    expect(screen.getByRole('button', { name: 'Save course' })).toBeTruthy();
  });
});
