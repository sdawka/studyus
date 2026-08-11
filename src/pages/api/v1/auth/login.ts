import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../../../db/client';
import { users } from '../../../../db/schema';
import { verifyPassword } from '../../../../lib/auth/password';
import { createSession, SESSION_COOKIE_NAME } from '../../../../lib/auth/session';
import { apiError, apiOk } from '../../../../lib/api';

const loginSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(1),
});

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('invalid_input', 'Email and password are required', 400);
  }

  const db = getDb(env.DB);
  const rows = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const user = rows[0];

  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return apiError('invalid_credentials', 'Incorrect email or password', 401);
  }

  const { token, expiresAt } = await createSession(db, user.id);

  cookies.set(SESSION_COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    expires: new Date(expiresAt),
  });

  return apiOk({ user: { id: user.id, email: user.email, name: user.name } });
};
