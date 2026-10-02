import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';

const authState = vi.hoisted(() => ({ userId: null as string | null, calls: 0 }));
vi.mock('@clerk/astro/server', () => ({
  clerkMiddleware: (handler: Function) => (context: unknown, next: unknown) => {
    authState.calls++;
    return handler(() => ({ userId: authState.userId }), context, next);
  },
  clerkClient: () => ({ users: { getUser: async (id: string) => ({
    id, externalId: null, primaryEmailAddress: { emailAddress: 'homepage@example.test' },
    firstName: 'Home', lastName: 'Learner',
  }) } }),
}));
import { onRequest } from '../src/middleware';

const db = getDb(env.DB);

beforeEach(async () => {
  authState.userId = null;
  authState.calls = 0;
  await db.delete(users);
});

async function requestHomepage(cookie?: string) {
  const url = new URL('https://old.studyus.app/');
  const context = {
    url, request: new Request(url, { headers: cookie ? { cookie } : {} }),
    locals: {} as { user?: typeof users.$inferSelect | null },
    redirect: (path: string) => Response.redirect(new URL(path, url), 302),
  };
  const response = await onRequest(context as never, async () => {
    const user = context.locals.user;
    if (user) return context.redirect(user.onboardedAt ? '/dashboard' : '/onboarding');
    return new Response('Public homepage');
  });
  if (!(response instanceof Response)) throw new Error('Homepage middleware returned no response');
  return { response, context };
}

describe('homepage after authentication', () => {
  it('returns a signed-in onboarded learner to the dashboard', async () => {
    authState.userId = 'user_homepage';
    await db.insert(users).values({ id: 'homepage-learner', clerkUserId: authState.userId,
      email: 'homepage@example.test', passwordHash: 'unused', onboardedAt: 1 });
    const { response, context } = await requestHomepage('__session=session-token');
    expect(context.locals.user?.id).toBe('homepage-learner');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://old.studyus.app/dashboard');
  });

  it('sends an unfinished signed-in learner to onboarding', async () => {
    authState.userId = 'user_homepage';
    await db.insert(users).values({ id: 'homepage-learner', clerkUserId: authState.userId,
      email: 'homepage@example.test', passwordHash: 'unused' });
    const { response } = await requestHomepage('__session=session-token');
    expect(response.headers.get('location')).toBe('https://old.studyus.app/onboarding');
  });

  it('serves the public homepage without Clerk for a visitor with no session', async () => {
    const { response } = await requestHomepage('theme=dark');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Public homepage');
    expect(authState.calls).toBe(0);
  });

  it('keeps the homepage public after Clerk rejects a stale session', async () => {
    const { response } = await requestHomepage('__session=stale-token');
    expect(response.status).toBe(200);
    expect(authState.calls).toBe(1);
  });
});
