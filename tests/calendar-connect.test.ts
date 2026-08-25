import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import { calendarConnections, calendarOutbox, calendarProviderCalendars, studySessions, users } from '../src/db/schema';
import type { CalendarTokenBroker } from '../src/lib/calendar/providers';
import { connectCalendarProvider } from '../src/lib/services/calendarConnect';

const db = getDb(env.DB);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('calendar provider connection bootstrap', () => {
  let userId: string;
  let clerkUserId: string;

  beforeEach(async () => {
    userId = crypto.randomUUID();
    clerkUserId = `user_${userId}`;
    await db.insert(users).values({ id: userId, clerkUserId, email: `${userId}@test.local`, passwordHash: 'x', timezone: 'America/Toronto' });
  });

  it('connects Google with least-privilege scopes, selects primary, and creates one owned Studyus calendar', async () => {
    const sessionId = crypto.randomUUID();
    const scheduledAt = Date.now() + 86_400_000;
    await db.insert(studySessions).values({
      id: sessionId,
      userId,
      intendedEventType: 'practice_done',
      plannedMinutes: 45,
      startedAt: scheduledAt,
      scheduledAt,
    });
    const getAccessToken = vi.fn().mockResolvedValue('google-token');
    const tokenBroker: CalendarTokenBroker = { getAccessToken };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('oauth2/v2/userinfo')) return json({ id: 'google-account-1', email: 'student@example.com' });
      if (url.includes('/users/me/calendarList')) return json({
        items: [{ id: 'primary@example.com', summary: 'Student', primary: true, timeZone: 'America/Toronto', accessRole: 'owner' }],
      });
      if (url.endsWith('/calendar/v3/calendars') && init?.method === 'POST') {
        return json({ id: 'studyus-calendar-1', summary: 'Studyus', timeZone: 'America/Toronto' }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await connectCalendarProvider(db, userId, clerkUserId, 'google', { fetch, tokenBroker, timezone: 'America/Toronto' });
    expect(result).toMatchObject({ provider: 'google', status: 'active', calendar_count: 2 });
    expect(getAccessToken).toHaveBeenCalledWith(clerkUserId, 'google', expect.arrayContaining([
      'https://www.googleapis.com/auth/calendar.events.readonly',
      'https://www.googleapis.com/auth/calendar.app.created',
    ]));

    const [connection] = (await db.select().from(calendarConnections)).filter((row) => row.userId === userId);
    const calendars = (await db.select().from(calendarProviderCalendars)).filter((row) => row.connectionId === connection.id);
    expect(calendars).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerCalendarId: 'primary@example.com', selected: true, studyusOwned: false }),
      expect.objectContaining({ providerCalendarId: 'studyus-calendar-1', selected: true, studyusOwned: true }),
    ]));
    expect((await db.select().from(calendarOutbox)).filter((row) => row.entityId === sessionId)).toEqual([
      expect.objectContaining({ connectionId: connection.id, action: 'upsert', entityType: 'study_session' }),
    ]);
  });

  it('reconnecting the same provider account reuses its owned Studyus calendar instead of creating another remote calendar', async () => {
    const tokenBroker: CalendarTokenBroker = { getAccessToken: vi.fn().mockResolvedValue('google-token') };
    let remoteCreateCount = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('oauth2/v2/userinfo')) return json({ id: 'same-google-account' });
      if (url.includes('/users/me/calendarList')) return json({
        items: [{ id: 'primary@example.com', summary: 'Student', primary: true, timeZone: 'America/Toronto', accessRole: 'owner' }],
      });
      if (url.endsWith('/calendar/v3/calendars') && init?.method === 'POST') {
        remoteCreateCount += 1;
        return json({
          id: `studyus-calendar-${remoteCreateCount}`,
          summary: 'Studyus',
          timeZone: 'America/Toronto',
        }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const first = await connectCalendarProvider(db, userId, clerkUserId, 'google', {
      fetch,
      tokenBroker,
      timezone: 'America/Toronto',
    });
    const second = await connectCalendarProvider(db, userId, clerkUserId, 'google', {
      fetch,
      tokenBroker,
      timezone: 'America/Toronto',
    });

    expect(second.id).toBe(first.id);
    expect(remoteCreateCount).toBe(1);
    const connections = (await db.select().from(calendarConnections)).filter((row) => row.userId === userId);
    expect(connections).toHaveLength(1);
    const calendars = (await db.select().from(calendarProviderCalendars))
      .filter((row) => row.connectionId === first.id);
    expect(calendars).toHaveLength(2);
    expect(calendars.filter((row) => row.studyusOwned)).toEqual([
      expect.objectContaining({ providerCalendarId: 'studyus-calendar-1' }),
    ]);
  });
});
