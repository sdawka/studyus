import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import {
  calendarConnections,
  calendarExternalEvents,
  calendarProviderCalendars,
  calendarSyncStates,
  users,
} from '../src/db/schema';
import {
  CalendarProviderHttpError,
  type CalendarProviderAdapter,
  type CalendarTokenBroker,
} from '../src/lib/calendar/providers';
import { syncProviderCalendar } from '../src/lib/services/calendarSyncEngine';

const db = getDb(env.DB);

describe('calendar sync engine', () => {
  let userId: string;
  let clerkUserId: string;
  let calendarId: string;

  beforeEach(async () => {
    userId = crypto.randomUUID();
    clerkUserId = `user_${userId}`;
    await db.insert(users).values({ id: userId, clerkUserId, email: `${userId}@test.local`, passwordHash: 'x', timezone: 'America/Toronto' });
    const connectionId = crypto.randomUUID();
    calendarId = crypto.randomUUID();
    await db.insert(calendarConnections).values({
      id: connectionId, userId, provider: 'google', externalAccountId: `acct-${userId}`, syncMode: 'controlled',
    });
    await db.insert(calendarProviderCalendars).values({
      id: calendarId, connectionId, providerCalendarId: 'primary', name: 'Primary', selected: true,
    });
    await db.insert(calendarSyncStates).values({ id: crypto.randomUUID(), providerCalendarId: calendarId, cursor: 'old-cursor' });
  });

  it('gets a fresh Clerk token, applies the delta idempotently, and advances the cursor last', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('fresh-token');
    const tokenBroker: CalendarTokenBroker = { getAccessToken };
    const sync = vi.fn().mockResolvedValue({
      cursor: 'new-cursor',
      changes: [{
        operation: 'upsert',
        event: {
          remoteId: 'remote-1', title: 'Part-time shift', start: '2026-09-01T14:00:00Z', end: '2026-09-01T18:00:00Z',
          allDay: false, updatedAt: '2026-08-25T12:00:00Z', localId: null, source: null, etag: 'v1', timezone: 'America/Toronto',
        },
      }],
    });
    const adapter: CalendarProviderAdapter = { name: 'google', sync, upsert: vi.fn(), delete: vi.fn() };

    const result = await syncProviderCalendar(db, calendarId, { google: adapter }, tokenBroker, {
      from: '2026-08-01T00:00:00Z', to: '2026-12-01T00:00:00Z',
    });
    expect(result).toEqual({ applied: 1, cursor: 'new-cursor' });
    expect(getAccessToken).toHaveBeenCalledWith(clerkUserId, 'google', expect.arrayContaining([
      'https://www.googleapis.com/auth/calendar.events.readonly',
    ]));
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'fresh-token', calendarId: 'primary', cursor: 'old-cursor' }));

    const events = (await db.select().from(calendarExternalEvents)).filter((row) => row.providerCalendarId === calendarId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ providerEventId: 'remote-1', providerVersion: 'v1', timezone: 'America/Toronto' });
    const [state] = (await db.select().from(calendarSyncStates)).filter((row) => row.providerCalendarId === calendarId);
    expect(state.cursor).toBe('new-cursor');
    expect(state.lastSyncedAt).not.toBeNull();
  });

  it('requests the same Microsoft scope granted by controlled connection setup', async () => {
    const connection = (await db.select().from(calendarConnections)).find((row) => row.userId === userId)!;
    await db.update(calendarConnections).set({ provider: 'microsoft' }).where(eq(calendarConnections.id, connection.id));

    const getAccessToken = vi.fn().mockResolvedValue('fresh-token');
    const tokenBroker: CalendarTokenBroker = { getAccessToken };
    const adapter: CalendarProviderAdapter = {
      name: 'microsoft',
      sync: vi.fn().mockResolvedValue({ cursor: 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=next', changes: [] }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    await syncProviderCalendar(db, calendarId, { microsoft: adapter }, tokenBroker, {
      from: '2026-08-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    });

    expect(getAccessToken).toHaveBeenCalledWith(clerkUserId, 'microsoft', ['Calendars.ReadWrite']);
  });

  it('stores only busy occupancy, not private titles, from provider-owned calendars', async () => {
    const tokenBroker: CalendarTokenBroker = { getAccessToken: vi.fn().mockResolvedValue('fresh-token') };
    const adapter: CalendarProviderAdapter = {
      name: 'google',
      sync: vi.fn().mockResolvedValue({
        cursor: 'privacy-cursor',
        changes: [{
          operation: 'upsert',
          event: {
            remoteId: 'private-remote-1',
            title: 'Oncology appointment — Dr. Smith',
            start: '2026-09-02T14:00:00Z',
            end: '2026-09-02T15:00:00Z',
            allDay: false,
            updatedAt: '2026-08-25T12:00:00Z',
            localId: null,
            source: null,
            etag: 'privacy-v1',
            timezone: 'America/Toronto',
            busyStatus: 'free',
          },
        }],
      }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    await syncProviderCalendar(db, calendarId, { google: adapter }, tokenBroker, {
      from: '2026-08-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    });

    const [stored] = (await db.select().from(calendarExternalEvents))
      .filter((row) => row.providerEventId === 'private-remote-1');
    expect(stored.title).toBe('Busy');
    expect(stored.busyStatus).toBe('free');
    expect(JSON.stringify(stored)).not.toContain('Oncology appointment');
  });

  it('keeps the existing cache and cursor when the 410 full-sync retry fails', async () => {
    await db.insert(calendarExternalEvents).values({
      id: crypto.randomUUID(),
      userId,
      providerCalendarId: calendarId,
      providerEventId: 'cached-event',
      title: 'Busy',
      startKind: 'timed',
      startAt: Date.parse('2026-09-03T14:00:00Z'),
      endAt: Date.parse('2026-09-03T15:00:00Z'),
      timezone: 'UTC',
      status: 'confirmed',
    });
    const sync = vi.fn()
      .mockRejectedValueOnce(new CalendarProviderHttpError(410, 'fullSyncRequired'))
      .mockRejectedValueOnce(new Error('provider unavailable'));
    const adapter: CalendarProviderAdapter = { name: 'google', sync, upsert: vi.fn(), delete: vi.fn() };
    const tokenBroker: CalendarTokenBroker = { getAccessToken: vi.fn().mockResolvedValue('fresh-token') };

    await expect(syncProviderCalendar(db, calendarId, { google: adapter }, tokenBroker, {
      from: '2026-08-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    })).rejects.toThrow('provider unavailable');

    expect(sync).toHaveBeenNthCalledWith(1, expect.objectContaining({ cursor: 'old-cursor' }));
    expect(sync).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: undefined }));
    const [cached] = (await db.select().from(calendarExternalEvents))
      .filter((row) => row.providerEventId === 'cached-event');
    expect(cached.status).toBe('confirmed');
    const [state] = (await db.select().from(calendarSyncStates)).filter((row) => row.providerCalendarId === calendarId);
    expect(state.cursor).toBe('old-cursor');
    expect(state.lastError).toBe('provider unavailable');
  });

  it('reconciles a successful full snapshot after 410 and advances its cursor last', async () => {
    await db.insert(calendarExternalEvents).values([
      {
        id: crypto.randomUUID(), userId, providerCalendarId: calendarId, providerEventId: 'still-current',
        title: 'Busy', startKind: 'timed', startAt: Date.parse('2026-09-03T14:00:00Z'),
        endAt: Date.parse('2026-09-03T15:00:00Z'), timezone: 'UTC', status: 'confirmed',
      },
      {
        id: crypto.randomUUID(), userId, providerCalendarId: calendarId, providerEventId: 'now-gone',
        title: 'Busy', startKind: 'timed', startAt: Date.parse('2026-09-04T14:00:00Z'),
        endAt: Date.parse('2026-09-04T15:00:00Z'), timezone: 'UTC', status: 'confirmed',
      },
    ]);
    const sync = vi.fn()
      .mockRejectedValueOnce(new CalendarProviderHttpError(410, 'fullSyncRequired'))
      .mockResolvedValueOnce({
        cursor: 'replacement-cursor',
        changes: [{
          operation: 'upsert',
          event: {
            remoteId: 'still-current', title: 'Private title', start: '2026-09-03T16:00:00Z',
            end: '2026-09-03T17:00:00Z', allDay: false, updatedAt: null,
            localId: null, source: null, timezone: 'UTC', etag: 'v2',
          },
        }],
      });
    const adapter: CalendarProviderAdapter = { name: 'google', sync, upsert: vi.fn(), delete: vi.fn() };
    const tokenBroker: CalendarTokenBroker = { getAccessToken: vi.fn().mockResolvedValue('fresh-token') };

    const result = await syncProviderCalendar(db, calendarId, { google: adapter }, tokenBroker, {
      from: '2026-08-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    });

    expect(result).toEqual({ applied: 2, cursor: 'replacement-cursor' });
    expect(sync).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cursor: undefined,
      from: '2026-08-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    }));
    const events = (await db.select().from(calendarExternalEvents))
      .filter((row) => row.providerCalendarId === calendarId);
    expect(events.find((row) => row.providerEventId === 'still-current')).toMatchObject({
      status: 'confirmed', providerVersion: 'v2', startAt: Date.parse('2026-09-03T16:00:00Z'),
    });
    expect(events.find((row) => row.providerEventId === 'now-gone')?.status).toBe('cancelled');
    const [state] = (await db.select().from(calendarSyncStates)).filter((row) => row.providerCalendarId === calendarId);
    expect(state.cursor).toBe('replacement-cursor');
  });
});
