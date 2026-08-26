import { clerkClient, clerkMiddleware } from '@clerk/astro/server';
import type { MiddlewareHandler } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from './db/client';
import { apiError } from './lib/api';
import { ClerkIdentityConflictError, resolveLocalUser } from './lib/auth/local-user';
import { hasUsableCourse } from './lib/services/onboarding';

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

function isOnboardingAllowed(pathname: string): boolean {
  return (
    pathname === '/onboarding' ||
    pathname.startsWith('/account') ||
    pathname === '/settings' ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/sign-up')
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
      user = await resolveLocalUser(db, {
        id: clerkUser.id,
        externalId: clerkUser.externalId,
        primaryEmailAddress: clerkUser.primaryEmailAddress?.emailAddress,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
      });
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

  if (user && !isApiPath(pathname) && !isPublicPage(pathname) && !isOnboardingAllowed(pathname)) {
    const usable = user.onboardedAt ? await hasUsableCourse(getDb(env.DB), user.id) : false;
    if (!user.onboardedAt || !usable) return context.redirect('/onboarding');
  }

  return next();
});

// The landing page and browser-local trial do not depend on identity. Keeping
// them outside Clerk initialization also keeps the public demo available during
// an auth-provider configuration problem or outage. No protected path bypasses
// Clerk through this wrapper.
export const onRequest: MiddlewareHandler = (context, next) => {
  if (isAuthIndependentPath(context.url.pathname)) {
    context.locals.user = null;
    return next();
  }
  return authenticatedRequest(context, next);
};
