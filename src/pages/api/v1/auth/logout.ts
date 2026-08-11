import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { invalidateSession, SESSION_COOKIE_NAME } from '../../../../lib/auth/session';
import { apiOk } from '../../../../lib/api';

export const POST: APIRoute = async ({ cookies }) => {
  const token = cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const db = getDb(env.DB);
    await invalidateSession(db, token);
  }
  cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
  return apiOk({ ok: true });
};
