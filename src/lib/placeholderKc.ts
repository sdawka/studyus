// Concept names that count as filler rather than something the learner chose.
//
// Bootstrap and onboarding validation agree on this definition. It is
// browser-safe so the onboarding form can warn before submitting, while
// src/lib/services/usableCourse.ts re-exports it for server callers.

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
