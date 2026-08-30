// Where an authenticated learner belongs relative to onboarding.
//
// Extracted from middleware.ts so the rule can be unit-tested: it decides
// whether someone can reach the app at all, and it has to be symmetric. The
// original only enforced one direction — a learner without a usable course was
// pushed to /onboarding, but a learner who had already finished was never
// pushed back out, so revisiting /onboarding ran the whole setup again and
// created a duplicate course (clearDemoDraft() wipes the draft id on success,
// so the per-draft idempotency check cannot catch that).

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
  const setUp = state.onboarded && state.hasUsableCourse;

  // Finished learners have no business in setup: /onboarding would happily
  // build them a second course.
  if (pathname === '/onboarding') return setUp ? '/dashboard' : null;

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
