// Where an authenticated learner belongs relative to onboarding.
//
// Extracted from middleware.ts so the rule can be unit-tested: it decides
// whether someone can reach the app at all. Completion is a one-way stamp:
// signed-in learners may later empty their workspace without being sent back
// through setup, while revisiting /onboarding must not create a duplicate.

/** Paths a learner may visit while they still have no usable course. */
export function isOnboardingAllowed(pathname: string): boolean {
  return (
    pathname === '/onboarding' ||
    pathname.startsWith('/account') ||
    pathname === '/settings' ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/sign-up')
  );
}

export interface OnboardingRouteState {
  /** Whether the learner has completed onboarding (users.onboardedAt is set). */
  onboarded: boolean;
  /** Whether they currently have a course they can actually use. */
  hasUsableCourse: boolean;
}

/**
 * The path to redirect to, or null to let the request through.
 *
 * Only call for authenticated, non-API, non-public page requests — the caller
 * owns those checks, and skipping this entirely for them avoids the
 * hasUsableCourse query.
 */
export function onboardingRedirect(pathname: string, state: OnboardingRouteState): string | null {
  // Provisioning guarantees a default course for new learners. Completion is
  // deliberately one-way: archiving every course later belongs to the normal
  // course empty state and must never reopen setup.
  const setUp = state.onboarded;

  // Finished learners have no business in setup: /onboarding would happily
  // build them a second course.
  if (pathname === '/onboarding') return setUp ? (state.hasUsableCourse ? '/dashboard' : '/courses') : null;

  // Unfinished learners get pushed back to setup, except on the few pages that
  // must stay reachable (account, settings, auth).
  if (isOnboardingAllowed(pathname)) return null;
  return setUp ? null : '/onboarding';
}

/**
 * Whether the caller needs to run the hasUsableCourse query for this path.
 * False for pages the rule cannot redirect either way, so they cost no query.
 */
export function needsUsableCourseCheck(pathname: string): boolean {
  return pathname === '/onboarding' || !isOnboardingAllowed(pathname);
}
