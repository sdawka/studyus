import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import { calendarConnections, calendarOutbox, calendarProviderCalendars, calendarProvisionLedger, studySessions, users } from '../src/db/schema';
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

  it('stops bootstrap before provider calls when account deletion wins during token retrieval', async () => {
    const fetch=vi.fn<typeof globalThis.fetch>();
    const tokenBroker={getAccessToken:async()=>{await db.update(users).set({accountState:'deleting'}).where(eq(users.id,userId));return 'synthetic-token';}};
    await expect(connectCalendarProvider(db,userId,clerkUserId,'google',{fetch,tokenBroker,timezone:'UTC'})).rejects.toThrow('Active calendar account not found');
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.select().from(calendarConnections).where(eq(calendarConnections.userId,userId))).toEqual([]);
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

  it('records a durable remote provision before local registration and hides its marker in the Google description', async () => {
    const tokenBroker: CalendarTokenBroker = { getAccessToken: vi.fn().mockResolvedValue('google-token') };
    let createBody: Record<string, unknown> | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('oauth2/v2/userinfo')) return json({ id: 'google-ledger-account' });
      if (url.includes('/users/me/calendarList')) return json({
        items: [{ id: 'primary@example.com', summary: 'Student', primary: true, timeZone: 'America/Toronto', accessRole: 'owner' }],
      });
      if (url.endsWith('/calendar/v3/calendars') && init?.method === 'POST') {
        createBody = JSON.parse(String(init.body));
        return json({ id: 'studyus-ledger-calendar', summary: 'Studyus', timeZone: 'America/Toronto' }, 201);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await connectCalendarProvider(db, userId, clerkUserId, 'google', { fetch, tokenBroker, timezone: 'America/Toronto' });

    const ledger = (await db.select().from(calendarProvisionLedger).where(eq(calendarProvisionLedger.userId, userId)))[0];
    expect(ledger).toMatchObject({
      provider: 'google', externalAccountId: 'google-ledger-account', remoteCalendarId: 'studyus-ledger-calendar', state: 'persisted',
      connectionId: expect.any(String), leaseToken: null, leaseExpiresAt: null,
    });
    expect(createBody).toMatchObject({ summary: 'Studyus', description: expect.stringContaining(ledger.marker) });
  });

  it('discovers a remotely-created marker after an interrupted local write without creating a second calendar', async () => {
    const marker = crypto.randomUUID();
    await db.insert(calendarProvisionLedger).values({
      id: crypto.randomUUID(), userId, provider: 'google', externalAccountId: 'google-recovery-account', marker,
      state: 'remote_created', remoteCalendarId: 'remote-before-d1', leaseToken: 'expired', leaseExpiresAt: Date.now() - 1,
    });
    const tokenBroker: CalendarTokenBroker = { getAccessToken: vi.fn().mockResolvedValue('google-token') };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('oauth2/v2/userinfo')) return json({ id: 'google-recovery-account' });
      if (url.includes('/users/me/calendarList')) return json({
        items: [
          { id: 'primary@example.com', summary: 'Student', primary: true, timeZone: 'America/Toronto', accessRole: 'owner' },
          { id: 'remote-before-d1', summary: 'Studyus', description: `Studyus provision marker: ${marker}`, timeZone: 'America/Toronto', accessRole: 'owner' },
        ],
      });
      if (url.endsWith('/calendar/v3/calendars') && init?.method === 'POST') throw new Error('must discover instead of creating');
      throw new Error(`Unexpected request: ${url}`);
    });

    const result = await connectCalendarProvider(db, userId, clerkUserId, 'google', { fetch, tokenBroker, timezone: 'America/Toronto' });

    expect(result.id).toEqual(expect.any(String));
    const ledger = (await db.select().from(calendarProvisionLedger).where(eq(calendarProvisionLedger.marker, marker)))[0];
    expect(ledger).toMatchObject({ state: 'persisted', remoteCalendarId: 'remote-before-d1', connectionId: result.id });
  });

  it('compensates by deleting a remote Studyus calendar when local registration fails', async () => {
    const tokenBroker: CalendarTokenBroker = { getAccessToken: vi.fn().mockResolvedValue('google-token') };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('oauth2/v2/userinfo')) return json({ id: 'google-compensation-account' });
      if (url.includes('/users/me/calendarList')) return json({
        items: [{ id: 'primary@example.com', summary: 'Student', primary: true, timeZone: 'America/Toronto', accessRole: 'owner' }],
      });
      if (url.endsWith('/calendar/v3/calendars') && init?.method === 'POST') return json({ id: 'remote-to-clean', summary: 'Studyus' }, 201);
      if (url.endsWith('/calendar/v3/calendars/remote-to-clean') && init?.method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${url}`);
    });
    await env.DB.exec("CREATE TRIGGER fail_provider_calendar BEFORE INSERT ON calendar_provider_calendars BEGIN SELECT RAISE(ABORT, 'forced local registration failure'); END");
    try {
      await expect(connectCalendarProvider(db, userId, clerkUserId, 'google', { fetch, tokenBroker, timezone: 'America/Toronto' })).rejects.toThrow();
    } finally {
      await env.DB.exec('DROP TRIGGER fail_provider_calendar');
    }
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/calendar/v3/calendars/remote-to-clean'), expect.objectContaining({ method: 'DELETE' }));
    expect(await db.select().from(calendarConnections).where(eq(calendarConnections.userId,userId))).toEqual([]);
    expect((await db.select().from(calendarProvisionLedger).where(eq(calendarProvisionLedger.userId, userId)))[0]).toMatchObject({ state: 'pending', remoteCalendarId: null });
  });

  it('retains a cleanup-failed provision for durable repair when compensation cannot delete remotely', async () => {
    const tokenBroker: CalendarTokenBroker = { getAccessToken: vi.fn().mockResolvedValue('google-token') };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('oauth2/v2/userinfo')) return json({ id: 'google-cleanup-failure-account' });
      if (url.includes('/users/me/calendarList')) return json({
        items: [{ id: 'primary@example.com', summary: 'Student', primary: true, timeZone: 'America/Toronto', accessRole: 'owner' }],
      });
      if (url.endsWith('/calendar/v3/calendars') && init?.method === 'POST') return json({ id: 'remote-not-cleaned', summary: 'Studyus' }, 201);
      if (url.endsWith('/calendar/v3/calendars/remote-not-cleaned') && init?.method === 'DELETE') return json({ error: 'provider down' }, 503);
      throw new Error(`Unexpected request: ${url}`);
    });
    await env.DB.exec("CREATE TRIGGER fail_provider_calendar_cleanup BEFORE INSERT ON calendar_provider_calendars BEGIN SELECT RAISE(ABORT, 'forced local registration failure'); END");
    try {
      await expect(connectCalendarProvider(db, userId, clerkUserId, 'google', { fetch, tokenBroker, timezone: 'America/Toronto' })).rejects.toThrow();
    } finally {
      await env.DB.exec('DROP TRIGGER fail_provider_calendar_cleanup');
    }
    expect((await db.select().from(calendarProvisionLedger).where(eq(calendarProvisionLedger.userId, userId)))[0]).toMatchObject({
      state: 'cleanup_failed', remoteCalendarId: 'remote-not-cleaned', lastError: expect.stringContaining('503'),
    });
  });
});
