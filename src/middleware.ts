import { clerkClient, clerkMiddleware } from '@clerk/astro/server';
import type { MiddlewareHandler } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from './db/client';
import { apiError } from './lib/api';
import { ClerkIdentityConflictError, resolveLocalUser } from './lib/auth/local-user';
import { canonicalRedirectUrl } from './lib/canonicalOrigin';
import { resolveSignupMethod } from './lib/analytics/identity';
import { queueBehavioralEvent } from './lib/analytics/server';
import { readAnalyticsCorrelation, readTrialHandoff } from './lib/analytics/session';
import { hasUsableCourse } from './lib/services/onboarding';
import { needsUsableCourseCheck, onboardingRedirect } from './lib/onboardingRoute';

const PUBLIC_PAGE_PATHS = new Set(['/', '/login', '/sign-in', '/sign-up', '/compare', '/how-it-works']);

function isPublicPage(pathname: string): boolean {
  return (
    PUBLIC_PAGE_PATHS.has(pathname) ||
    pathname.startsWith('/sign-in/') ||
    pathname.startsWith('/sign-up/') ||
    pathname === '/try' ||
    pathname.startsWith('/try/')
  );
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function isPublicApiPath(pathname: string): boolean {
  return pathname === '/api/public/demo-events' || pathname.startsWith('/api/calendar/feed/');
}

function isAuthIndependentPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/compare' ||
    pathname === '/how-it-works' ||
    pathname === '/try' ||
    pathname.startsWith('/try/') ||
    isPublicApiPath(pathname)
  );
}


/**
 * Clerk owns authentication; this middleware resolves that identity to the
 * existing local learner row and retains `locals.user` for the rest of the
 * application. No route is allowed to infer a local user from a request.
 */
const authenticatedRequest = clerkMiddleware(async (auth, context, next) => {
  const { pathname } = context.url;
  const clerkAuth = auth();
  let user = null;

  if (clerkAuth.userId) {
    try {
      const clerkUser = await clerkClient(context).users.getUser(clerkAuth.userId);
      const db = getDb(env.DB);
      const resolution = await resolveLocalUser(db, {
        id: clerkUser.id,
        externalId: clerkUser.externalId,
        primaryEmailAddress: clerkUser.primaryEmailAddress?.emailAddress,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
      });
      user = resolution.user;
      if (resolution.wasCreated) {
        const correlation = readAnalyticsCorrelation(context.request.headers.get('cookie'));
        if (correlation.session_id) {
          const trialSessionId = readTrialHandoff(context.request.headers.get('cookie'));
          queueBehavioralEvent({
            env,
            request: context.request,
            execution: context.locals.cfContext,
            user_id: user.id,
            analytics_opt_out: false,
          }, {
            name: 'signup_completed',
            user_id: user.id,
            session_id: correlation.session_id,
            surface: pathname.startsWith('/sign-up') ? '/sign-up/[...path]' : '/onboarding',
            ts: Date.now(),
            method: resolveSignupMethod({
              external_account_count: clerkUser.externalAccounts.length,
              has_phone: clerkUser.phoneNumbers.length > 0,
              has_email: clerkUser.emailAddresses.length > 0,
            }),
            ...(trialSessionId ? { trial_session_id: trialSessionId } : {}),
          });
        }
      }
    } catch (error) {
      if (error instanceof ClerkIdentityConflictError) {
        if (isApiPath(pathname)) return apiError('identity_conflict', error.message, 409);
        return new Response(error.message, { status: 409 });
      }
      throw error;
    }
  }

  context.locals.user = user;

  if (!user && !isPublicPage(pathname) && !isPublicApiPath(pathname)) {
    if (isApiPath(pathname)) return apiError('unauthorized', 'Authentication required', 401);
    return clerkAuth.redirectToSignIn({ returnBackUrl: context.url.href });
  }

  if (user && !isApiPath(pathname) && !isPublicPage(pathname) && needsUsableCourseCheck(pathname)) {
    const usable = user.onboardedAt ? await hasUsableCourse(getDb(env.DB), user.id) : false;
    const destination = onboardingRedirect(pathname, { onboarded: Boolean(user.onboardedAt), hasUsableCourse: usable });
    if (destination) return context.redirect(destination);
  }

  return next();
});

// The landing page and browser-local trial do not depend on identity. Keeping
// them outside Clerk initialization also keeps the public demo available during
// an auth-provider configuration problem or outage. No protected path bypasses
// Clerk through this wrapper.
export const onRequest: MiddlewareHandler = (context, next) => {
  const canonicalUrl = canonicalRedirectUrl(context.url);
  if (canonicalUrl) return Response.redirect(canonicalUrl, 308);

  if (isAuthIndependentPath(context.url.pathname)) {
    context.locals.user = null;
    return next();
  }
  return authenticatedRequest(context, next);
};
