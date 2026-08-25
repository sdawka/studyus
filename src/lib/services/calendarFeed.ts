import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { calendarFeedCredentials, users } from '../../db/schema';
import { hashCalendarFeedToken, issueCalendarFeedCredential } from '../calendar/ics';

export async function issueCalendarFeed(db: Db, userId: string) {
  const credential = await issueCalendarFeedCredential();
  const now = Date.now();
  await db
    .insert(calendarFeedCredentials)
    .values({
      id: crypto.randomUUID(),
      userId,
      tokenHash: credential.tokenHash,
      revokedAt: null,
      updatedAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: calendarFeedCredentials.userId,
      set: { tokenHash: credential.tokenHash, revokedAt: null, updatedAt: now },
    });
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
    .where(and(eq(calendarFeedCredentials.tokenHash, tokenHash), isNull(calendarFeedCredentials.revokedAt)))
    .limit(1);
  return user ?? null;
}
