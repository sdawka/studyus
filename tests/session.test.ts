import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { sessions, users } from '../src/db/schema';
import {
  createSession,
  generateSessionToken,
  hashToken,
  invalidateSession,
  validateSessionToken,
} from '../src/lib/auth/session';

// Mirrors the private constants in src/lib/auth/session.ts — duplicated here
// only so tests can place expiresAt values on either side of the renewal
// boundary and assert on the exact renewed value.
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

const db = getDb(env.DB);

let userId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
});

async function insertRawSession(expiresAt: number): Promise<string> {
  const token = generateSessionToken();
  const sessionId = await hashToken(token);
  await db.insert(sessions).values({ id: sessionId, userId, expiresAt });
  return token;
}

describe('validateSessionToken', () => {
  it('treats an expired session as invalid and deletes its row', async () => {
    const token = await insertRawSession(Date.now() - 1000);
    const sessionId = await hashToken(token);

    const result = await validateSessionToken(db, token);
    expect(result.session).toBeNull();
    expect(result.user).toBeNull();

    const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(rows).toHaveLength(0);
  });

  it('returns a session outside the renewal window unmodified', async () => {
    const farExpiry = Date.now() + SESSION_DURATION_MS; // well outside RENEW_THRESHOLD_MS
    const token = await insertRawSession(farExpiry);
    const sessionId = await hashToken(token);

    const result = await validateSessionToken(db, token);
    expect(result.session?.expiresAt).toBe(farExpiry);
    expect(result.user?.id).toBe(userId);

    const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(rows[0].expiresAt).toBe(farExpiry);
  });

  it('renews (extends expiresAt by SESSION_DURATION_MS) a session inside the renewal window', async () => {
    const nearExpiry = Date.now() + RENEW_THRESHOLD_MS - 1000; // just inside the renewal window
    const token = await insertRawSession(nearExpiry);
    const sessionId = await hashToken(token);

    const before = Date.now();
    const result = await validateSessionToken(db, token);
    const after = Date.now();

    expect(result.session?.expiresAt).not.toBe(nearExpiry);
    expect(result.session!.expiresAt).toBeGreaterThanOrEqual(before + SESSION_DURATION_MS);
    expect(result.session!.expiresAt).toBeLessThanOrEqual(after + SESSION_DURATION_MS);

    const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(rows[0].expiresAt).toBe(result.session!.expiresAt);
  });

  it('returns {session:null,user:null} for a token that was never issued', async () => {
    const result = await validateSessionToken(db, generateSessionToken());
    expect(result).toEqual({ session: null, user: null });
  });
});

describe('createSession', () => {
  it('persists a row hashed from the returned token, expiring SESSION_DURATION_MS out', async () => {
    const before = Date.now();
    const { token, expiresAt } = await createSession(db, userId);
    const after = Date.now();

    expect(expiresAt).toBeGreaterThanOrEqual(before + SESSION_DURATION_MS);
    expect(expiresAt).toBeLessThanOrEqual(after + SESSION_DURATION_MS);

    const result = await validateSessionToken(db, token);
    expect(result.user?.id).toBe(userId);
    expect(result.session?.expiresAt).toBe(expiresAt);
  });
});

describe('invalidateSession', () => {
  it('deletes the session so a later validation returns null', async () => {
    const { token } = await createSession(db, userId);
    expect((await validateSessionToken(db, token)).user).not.toBeNull();

    await invalidateSession(db, token);

    const result = await validateSessionToken(db, token);
    expect(result).toEqual({ session: null, user: null });
  });
});
