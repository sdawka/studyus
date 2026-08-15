import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { createSession, generateSessionToken, SESSION_COOKIE_NAME } from '../src/lib/auth/session';

// `astro:middleware` is a Vite virtual module supplied by Astro's own
// integration during dev/build; the workers vitest pool here doesn't run
// through Astro's Vite plugin, so the bare specifier can't resolve. Its
// real implementation (astro/dist/core/middleware/defineMiddleware.js) is
// just `(fn) => fn` — stub exactly that so src/middleware.ts imports
// cleanly and its actual `onRequest` logic runs unmodified.
vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: unknown) => fn,
}));

const { onRequest } = await import('../src/middleware');

const db = getDb(env.DB);

let userId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x', name: 'Test User' });
});

// Minimal Astro APIContext stand-in — same direct-invocation style as
// tests/routes/**, extended with cookies/redirect since middleware (unlike
// route handlers) reads/writes both.
function makeContext(path: string, cookieValue?: string) {
  const store = new Map<string, string>();
  if (cookieValue !== undefined) store.set(SESSION_COOKIE_NAME, cookieValue);
  const deleted: string[] = [];

  const context = {
    url: new URL(path, 'http://local.test'),
    cookies: {
      get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
      set: (name: string, value: string) => store.set(name, value),
      delete: (name: string) => {
        deleted.push(name);
        store.delete(name);
      },
      has: (name: string) => store.has(name),
    },
    locals: {} as { user: unknown },
    redirect: (redirectPath: string, status = 302) => new Response(null, { status, headers: { Location: redirectPath } }),
  };

  return { context, deleted };
}

function makeNext() {
  return vi.fn(async () => new Response('downstream', { status: 200 }));
}

describe('middleware: no session cookie', () => {
  it('returns a 401 apiError envelope for a protected /api/v1/* path, never calling next', async () => {
    const { context } = makeContext('/api/v1/tasks');
    const next = makeNext();

    const res = await onRequest(context as any, next);
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error).toEqual({ code: 'unauthorized', message: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
    expect(context.locals.user).toBeNull();
  });

  it('redirects a protected page path to /login', async () => {
    const { context } = makeContext('/dashboard');
    const next = makeNext();

    const res = await onRequest(context as any, next);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
    expect(next).not.toHaveBeenCalled();
  });

  it('lets /login itself through with no cookie', async () => {
    const { context } = makeContext('/login');
    const next = makeNext();

    await onRequest(context as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('lets /api/v1/auth/* through with no cookie', async () => {
    const { context } = makeContext('/api/v1/auth/login');
    const next = makeNext();

    await onRequest(context as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(context.locals.user).toBeNull();
  });
});

describe('middleware: invalid/expired session cookie', () => {
  it('deletes the cookie and treats the request as unauthenticated (401 on an API path)', async () => {
    const { context, deleted } = makeContext('/api/v1/tasks', generateSessionToken());
    const next = makeNext();

    const res = await onRequest(context as any, next);
    expect(res.status).toBe(401);
    expect(deleted).toEqual([SESSION_COOKIE_NAME]);
    expect(next).not.toHaveBeenCalled();
    expect(context.locals.user).toBeNull();
  });

  it('deletes the cookie and redirects a page path to /login', async () => {
    const { context, deleted } = makeContext('/dashboard', generateSessionToken());
    const next = makeNext();

    const res = await onRequest(context as any, next);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
    expect(deleted).toEqual([SESSION_COOKIE_NAME]);
  });
});

describe('middleware: valid session cookie', () => {
  it('populates locals.user and calls next, passing its response through untouched', async () => {
    const { token } = await createSession(db, userId);
    const { context, deleted } = makeContext('/api/v1/tasks', token);
    const next = makeNext();

    const res = await onRequest(context as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual([]);
    expect((context.locals.user as any).id).toBe(userId);
    expect((context.locals.user as any).email).toBe(`${userId}@test.local`);
    expect(await res.text()).toBe('downstream');
    expect(res.status).toBe(200);
  });

  it('still populates locals.user and calls next on a non-API page path', async () => {
    const { token } = await createSession(db, userId);
    const { context } = makeContext('/dashboard', token);
    const next = makeNext();

    await onRequest(context as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((context.locals.user as any).id).toBe(userId);
  });
});
