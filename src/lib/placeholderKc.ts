// Concept names that count as filler rather than something the learner chose.
//
// Three places have to agree about this: onboarding completion, the course-map
// editor's "keep at least one meaningful active concept" rule, and — since a
// course whose concepts are all filler leaves the learner without a usable
// course — the middleware gate that decides whether they can reach the app.
//
// The onboarding form is now a fourth consumer: it warns before submitting
// rather than letting the server accept the import and then report it as
// incomplete. That means the rule has to be importable by browser code, so it
// lives here with no database imports. src/lib/services/usableCourse.ts
// re-exports it for the server callers that already depend on it.

/**
 * Filler concept names. A course whose concepts are all drawn from this set has
 * not really been set up, so it does not count toward "usable".
 */
export const PLACEHOLDER_KC_NAMES: ReadonlySet<string> = new Set([
  'general',
  'course topic',
  'course foundations',
]);

/** True when a concept name is filler rather than something the learner chose. */
export function isPlaceholderKcName(name: string): boolean {
  return PLACEHOLDER_KC_NAMES.has(name.trim().toLowerCase());
}
