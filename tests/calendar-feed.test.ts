import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { calendarFeedCredentials, users } from '../src/db/schema';
import { issueCalendarFeed, resolveCalendarFeedUser, revokeCalendarFeed } from '../src/lib/services/calendarFeed';

const db = getDb(env.DB);
let userId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x', timezone: 'America/Toronto' });
});

describe('calendar feed credentials', () => {
  it('persists only a digest and rotates the previous bearer token', async () => {
    const first = await issueCalendarFeed(db, userId);
    expect(await resolveCalendarFeedUser(db, first.token)).toMatchObject({ id: userId });

    const second = await issueCalendarFeed(db, userId);
    expect(second.token).not.toBe(first.token);
    expect(await resolveCalendarFeedUser(db, first.token)).toBeNull();
    expect(await resolveCalendarFeedUser(db, second.token)).toMatchObject({ id: userId });

    const [stored] = (await db.select().from(calendarFeedCredentials)).filter((row) => row.userId === userId);
    expect(stored.tokenHash).not.toContain(second.token);
    expect(Object.keys(stored)).not.toContain('token');
  });

  it('revokes the feed without deleting the user', async () => {
    const { token } = await issueCalendarFeed(db, userId);
    await revokeCalendarFeed(db, userId);
    expect(await resolveCalendarFeedUser(db, token)).toBeNull();
  });
});
