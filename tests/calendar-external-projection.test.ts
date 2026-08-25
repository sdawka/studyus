import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { calendarConnections, calendarExternalEvents, calendarProviderCalendars, users } from '../src/db/schema';
import { getCalendar } from '../src/lib/services/calendar';

const db = getDb(env.DB);

describe('external calendar projection', () => {
  it('includes selected confirmed provider events with collision-safe IDs and excludes unselected/cancelled rows', async () => {
    const userId = crypto.randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x', timezone: 'America/Toronto' });
    const connectionId = crypto.randomUUID();
    await db.insert(calendarConnections).values({
      id: connectionId,
      userId,
      provider: 'google',
      externalAccountId: `acct-${userId}`,
    });
    const selectedCalendarId = crypto.randomUUID();
    const hiddenCalendarId = crypto.randomUUID();
    await db.insert(calendarProviderCalendars).values([
      { id: selectedCalendarId, connectionId, providerCalendarId: 'primary', name: 'Primary', selected: true },
      { id: hiddenCalendarId, connectionId, providerCalendarId: 'hidden', name: 'Hidden', selected: false },
    ]);
    const start = Date.now() + 60_000;
    await db.insert(calendarExternalEvents).values([
      {
        id: crypto.randomUUID(), userId, providerCalendarId: selectedCalendarId, providerEventId: 'same-id',
        title: 'Work shift', startKind: 'timed', startAt: start, endAt: start + 3_600_000,
        timezone: 'America/Toronto', status: 'confirmed',
      },
      {
        id: crypto.randomUUID(), userId, providerCalendarId: selectedCalendarId, providerEventId: 'cancelled',
        title: 'Cancelled', startKind: 'timed', startAt: start, endAt: start + 3_600_000,
        timezone: 'America/Toronto', status: 'cancelled',
      },
      {
        id: crypto.randomUUID(), userId, providerCalendarId: hiddenCalendarId, providerEventId: 'hidden',
        title: 'Hidden', startKind: 'timed', startAt: start, endAt: start + 3_600_000,
        timezone: 'America/Toronto', status: 'confirmed',
      },
    ]);

    const items = await getCalendar(db, userId, start - 1, start + 86_400_000, undefined, { sweep: false });
    const external = items.filter((item) => item.type === 'external_event');
    expect(external).toHaveLength(1);
    expect(external[0]).toMatchObject({
      id: 'provider.google:same-id',
      title: 'Work shift',
      all_day: false,
      course_id: null,
      details: {
        provider: 'google',
        ownership: 'provider',
        sync_policy: 'read-only',
        busy_status: 'busy',
        timezone: 'America/Toronto',
      },
    });
  });
});
