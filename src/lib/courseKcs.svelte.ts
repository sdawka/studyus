// The data behind the "Concepts covered" chip picker: a course's knowledge
// components, fetched lazily on the first add-open or edit-open and shared by
// every form in the card rather than re-fetched per form.
//
// The one rule worth stating out loud, because getting it wrong made the picker
// permanently useless after a blip: a failure is not an answer. `kcs` stays null
// until a load actually succeeds, so a failed attempt leaves the source
// loadable again — reopening a form retries, and the picker can offer a Retry.
// Parking [] there instead satisfied the "already loaded" guard forever.
//
// Source: `/api/v1/courses/:slug` (the same branches+kcs endpoint StandingTab
// already calls) via the slug in the courseContext store, which CourseLayout's
// CourseContextSetter island writes for this exact course — no new endpoint and
// no new prop threaded down. An unmatched context is reported like any other
// failure (and is retryable) rather than presenting as "no concepts here".
import { apiFetch } from './apiClient';
import { courseContext } from './stores/courseContext';

export interface Kc {
  id: string;
  name: string;
}

export class CourseKcsSource {
  /** null = not loaded (never fetched, or the last attempt failed). [] = this course has none. */
  kcs = $state<Kc[] | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  // A getter, not the value: the course id is a prop upstream, and capturing
  // props by value is the bug this card already had once.
  readonly #courseId: () => string;

  constructor(courseId: () => string) {
    this.#courseId = courseId;
  }

  /** Load unless a load already succeeded or is in flight. */
  ensureLoaded() {
    if (this.kcs !== null) return;
    void this.#load();
  }

  /** Load again regardless — what the user's Retry means. */
  retry() {
    void this.#load();
  }

  async #load() {
    if (this.loading) return;
    this.loading = true;
    this.error = null;
    try {
      const ctx = courseContext.get();
      const slug = ctx && ctx.id === this.#courseId() ? ctx.slug : null;
      if (!slug) {
        this.error = 'Could not resolve course.';
        return;
      }
      const result = await apiFetch<{ branches?: { kcs: Kc[] }[] }>(
        `/api/v1/courses/${slug}`,
        {},
        'Could not load concepts.',
        'Network error.',
      );
      if (!result.ok) {
        // A non-ok response always shows this fixed message (ignoring whatever
        // the server said); only a true network failure shows its own message.
        this.error = result.reason === 'network' ? result.error : 'Could not load concepts.';
        return;
      }
      const branches: { kcs: Kc[] }[] = result.data.branches ?? [];
      this.kcs = branches.flatMap((b) => b.kcs.map((k) => ({ id: k.id, name: k.name })));
    } finally {
      this.loading = false;
    }
  }
}
