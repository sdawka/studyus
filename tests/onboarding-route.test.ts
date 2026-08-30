import { describe, expect, it } from 'vitest';
import { needsUsableCourseCheck, onboardingRedirect } from '../src/lib/onboardingRoute';

const NEW_USER = { onboarded: false, hasUsableCourse: false };
const HALF_SET_UP = { onboarded: true, hasUsableCourse: false };
const SET_UP = { onboarded: true, hasUsableCourse: true };

describe('onboardingRedirect: unfinished learners are sent to setup', () => {
  it('pushes a new learner to /onboarding from an app page', () => {
    expect(onboardingRedirect('/dashboard', NEW_USER)).toBe('/onboarding');
    expect(onboardingRedirect('/courses', NEW_USER)).toBe('/onboarding');
    expect(onboardingRedirect('/planner', NEW_USER)).toBe('/onboarding');
  });

  it('pushes a learner who lost their last usable course, even though onboarded', () => {
    // This is the state the archive guard now prevents, but the rule must still
    // handle it: onboardedAt is set, yet there is nothing usable to show.
    expect(onboardingRedirect('/dashboard', HALF_SET_UP)).toBe('/onboarding');
  });

  it('leaves the escape hatches reachable while unfinished', () => {
    for (const path of ['/settings', '/account', '/account/profile', '/sign-in', '/sign-up']) {
      expect(onboardingRedirect(path, NEW_USER)).toBeNull();
    }
  });

  it('lets an unfinished learner stay on /onboarding', () => {
    expect(onboardingRedirect('/onboarding', NEW_USER)).toBeNull();
    expect(onboardingRedirect('/onboarding', HALF_SET_UP)).toBeNull();
  });
});

describe('onboardingRedirect: finished learners are sent out of setup', () => {
  it('redirects a fully set-up learner away from /onboarding', () => {
    // Previously nothing did this, so revisiting /onboarding re-ran the whole
    // flow and created a second course — clearDemoDraft() wipes the draft id on
    // success, so the per-draft idempotency check could not catch it.
    expect(onboardingRedirect('/onboarding', SET_UP)).toBe('/dashboard');
  });

  it('lets a fully set-up learner reach the app normally', () => {
    for (const path of ['/dashboard', '/courses', '/planner', '/settings', '/account']) {
      expect(onboardingRedirect(path, SET_UP)).toBeNull();
    }
  });
});

describe('needsUsableCourseCheck: only query when the answer can matter', () => {
  it('is true for app pages and for /onboarding', () => {
    expect(needsUsableCourseCheck('/dashboard')).toBe(true);
    expect(needsUsableCourseCheck('/onboarding')).toBe(true);
  });

  it('is false for pages the rule never redirects either way', () => {
    for (const path of ['/settings', '/account', '/sign-in', '/sign-up']) {
      expect(needsUsableCourseCheck(path)).toBe(false);
    }
  });

  it('covers every path the redirect rule can act on', () => {
    // Guards the invariant the middleware depends on: if a path can produce a
    // redirect, the caller must have run the query for it.
    for (const path of ['/dashboard', '/courses', '/planner', '/onboarding', '/settings', '/account', '/sign-in']) {
      const acts = onboardingRedirect(path, NEW_USER) !== null || onboardingRedirect(path, SET_UP) !== null;
      if (acts) expect(needsUsableCourseCheck(path)).toBe(true);
    }
  });
});
