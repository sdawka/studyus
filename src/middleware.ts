import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { getDb } from './db/client';
import { SESSION_COOKIE_NAME, validateSessionToken } from './lib/auth/session';
import { apiError } from './lib/api';

const PUBLIC_PAGE_PATHS = new Set(['/login']);

function isPublicApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/v1/auth/');
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const db = getDb(env.DB);

  const token = context.cookies.get(SESSION_COOKIE_NAME)?.value;
  let user = null;

  if (token) {
    const result = await validateSessionToken(db, token);
    user = result.user;
    if (!result.session) {
      context.cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
    }
  }

  context.locals.user = user;

  const isApiPath = pathname.startsWith('/api/v1/');

  if (!user) {
    if (isApiPath && !isPublicApiPath(pathname)) {
      return apiError('unauthorized', 'Authentication required', 401);
    }
    if (!isApiPath && !PUBLIC_PAGE_PATHS.has(pathname)) {
      return context.redirect('/login');
    }
  }

  return next();
});
