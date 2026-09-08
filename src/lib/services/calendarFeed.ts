import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { calendarFeedCredentials, users } from '../../db/schema';
import { hashCalendarFeedToken, issueCalendarFeedCredential } from '../calendar/ics';
import { NotFoundError } from './util';

export async function issueCalendarFeed(db: Db, userId: string) {
  const credential = await issueCalendarFeedCredential();
  const now = Date.now();
  const result = await db.run(sql`INSERT INTO calendar_feed_credentials (id,user_id,token_hash,revoked_at,updated_at,created_at)
    SELECT ${crypto.randomUUID()}, ${userId}, ${credential.tokenHash}, NULL, ${now}, ${now}
    WHERE EXISTS (SELECT 1 FROM users WHERE id=${userId} AND account_state='active')
    ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,revoked_at=NULL,updated_at=excluded.updated_at`);
  if (result.meta.changes !== 1) throw new NotFoundError('Account');
  return credential;
}

export async function revokeCalendarFeed(db: Db, userId: string): Promise<void> {
  await db
    .update(calendarFeedCredentials)
    .set({ revokedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(calendarFeedCredentials.userId, userId));
}

export async function resolveCalendarFeedUser(db: Db, token: string) {
  if (!token) return null;
  const tokenHash = await hashCalendarFeedToken(token);
  const [user] = await db
    .select({ id: users.id, name: users.name, timezone: users.timezone })
    .from(calendarFeedCredentials)
    .innerJoin(users, eq(calendarFeedCredentials.userId, users.id))
    .where(and(eq(calendarFeedCredentials.tokenHash, tokenHash), isNull(calendarFeedCredentials.revokedAt), eq(users.accountState, 'active')))
    .limit(1);
  return user ?? null;
}
