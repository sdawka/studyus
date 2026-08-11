// Lucia-guide-pattern sessions: a random token is given to the client as a
// cookie; only the SHA-256 hash of the token (the "session id") is stored in
// D1. This means a leaked DB row can never be replayed as a cookie.
import { getDb } from '../../db/client';
import { sessions, users } from '../../db/schema';
import { eq } from 'drizzle-orm';

export const SESSION_COOKIE_NAME = 'studybuddy_session';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000; // renew once halfway through

function base32Encode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output.toLowerCase();
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base32Encode(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(db: ReturnType<typeof getDb>, userId: string) {
  const token = generateSessionToken();
  const sessionId = await hashToken(token);
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  await db.insert(sessions).values({ id: sessionId, userId, expiresAt });
  return { token, expiresAt };
}

export async function validateSessionToken(db: ReturnType<typeof getDb>, token: string) {
  const sessionId = await hashToken(token);
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return { session: null, user: null };

  if (Date.now() >= row.session.expiresAt) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return { session: null, user: null };
  }

  // Sliding expiry: extend once we're past the renewal threshold.
  if (row.session.expiresAt - Date.now() < RENEW_THRESHOLD_MS) {
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, sessionId));
    row.session.expiresAt = expiresAt;
  }

  return { session: row.session, user: row.user };
}

export async function invalidateSession(db: ReturnType<typeof getDb>, token: string) {
  const sessionId = await hashToken(token);
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
