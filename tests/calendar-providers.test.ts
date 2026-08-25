import { describe, expect, it, vi } from 'vitest';
import { createClerkCalendarTokenBroker, ProviderTokenUnavailableError } from '../src/lib/calendar/providers/clerk-token-broker';
import { createGoogleCalendarProvider } from '../src/lib/calendar/providers/google';
import { createMicrosoftCalendarProvider } from '../src/lib/calendar/providers/microsoft';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('Google Calendar provider', () => {
  it('paginates incremental syncs and preserves deletes, ETags, and private extended properties', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json({
          items: [
            {
              id: 'google-1',
              etag: '"etag-1"',
              status: 'confirmed',
              transparency: 'transparent',
              summary: 'Review chemistry',
              start: { dateTime: '2026-09-01T14:00:00Z' },
              end: { dateTime: '2026-09-01T14:30:00Z' },
              updated: '2026-08-25T14:00:00Z',
              extendedProperties: {
                private: { studyus_event_id: 'local-1', studyus_source: 'study_session' },
              },
            },
          ],
          nextPageToken: 'page-2',
        }),
      )
      .mockResolvedValueOnce(
        json({
          items: [{ id: 'google-2', etag: '"etag-2"', status: 'cancelled' }],
          nextSyncToken: 'sync-next',
        }),
      );

    const provider = createGoogleCalendarProvider({ fetch });
    const result = await provider.sync({
      accessToken: 'google-token',
      calendarId: 'primary',
      cursor: 'sync-old',
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetch.mock.calls[0]![0]));
    expect(firstUrl.pathname).toBe('/calendar/v3/calendars/primary/events');
    expect(firstUrl.searchParams.get('syncToken')).toBe('sync-old');
    expect(firstUrl.searchParams.get('showDeleted')).toBe('true');
    const secondUrl = new URL(String(fetch.mock.calls[1]![0]));
    expect(secondUrl.searchParams.get('pageToken')).toBe('page-2');
    expect(result.cursor).toBe('sync-next');
    expect(result.changes).toEqual([
      expect.objectContaining({
        operation: 'upsert',
        event: expect.objectContaining({
          remoteId: 'google-1',
          etag: '"etag-1"',
          localId: 'local-1',
          source: 'study_session',
          allDay: false,
          busyStatus: 'free',
        }),
      }),
      { operation: 'delete', remoteId: 'google-2', etag: '"etag-2"' },
    ]);
  });

  it('writes Studyus metadata and uses ETags for conditional updates and deletes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ id: 'google-1', etag: '"etag-2"' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = createGoogleCalendarProvider({ fetch });

    await provider.upsert({
      accessToken: 'google-token',
      calendarId: 'primary',
      remoteId: 'google-1',
      etag: '"etag-1"',
      event: {
        localId: 'local-1',
        source: 'assessment_due',
        title: 'Midterm',
        start: '2026-09-02',
        end: '2026-09-03',
        allDay: true,
      },
    });
    await provider.delete({
      accessToken: 'google-token',
      calendarId: 'primary',
      remoteId: 'google-1',
      etag: '"etag-2"',
    });

    const updateInit = fetch.mock.calls[0]![1]!;
    expect(updateInit.method).toBe('PATCH');
    expect(new Headers(updateInit.headers).get('if-match')).toBe('"etag-1"');
    expect(JSON.parse(String(updateInit.body))).toMatchObject({
      summary: 'Midterm',
      start: { date: '2026-09-02' },
      end: { date: '2026-09-03' },
      extendedProperties: {
        private: { studyus_event_id: 'local-1', studyus_source: 'assessment_due' },
      },
    });
    const deleteInit = fetch.mock.calls[1]![1]!;
    expect(deleteInit.method).toBe('DELETE');
    expect(new Headers(deleteInit.headers).get('if-match')).toBe('"etag-2"');
  });

  it('uses the deterministic transaction key as the provider event ID on create', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
      json({ id: 'stud1abc123', etag: '"etag-1"' }, { status: 201 }),
    );
    const provider = createGoogleCalendarProvider({ fetch });

    await provider.upsert({
      accessToken: 'google-token',
      calendarId: 'primary',
      event: {
        localId: 'local-1',
        source: 'study_session',
        transactionId: 'stud1abc123',
        title: 'Study',
        start: '2026-09-01T15:00:00Z',
        end: '2026-09-01T15:30:00Z',
        allDay: false,
      },
    });

    const body = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(body.id).toBe('stud1abc123');
    expect(fetch.mock.calls[0]![1]!.method).toBe('POST');
  });

  it('recovers a create whose deterministic event ID already exists by patching it', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ error: { message: 'Identifier exists' } }, { status: 409 }))
      .mockResolvedValueOnce(json({ id: 'stud1abc123', etag: '"etag-2"' }));
    const provider = createGoogleCalendarProvider({ fetch });

    await expect(
      provider.upsert({
        accessToken: 'google-token',
        calendarId: 'primary',
        event: {
          localId: 'local-1',
          source: 'study_session',
          transactionId: 'stud1abc123',
          title: 'Study',
          start: '2026-09-01T15:00:00Z',
          end: '2026-09-01T15:30:00Z',
          allDay: false,
        },
      }),
    ).resolves.toEqual({ remoteId: 'stud1abc123', etag: '"etag-2"' });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![0]).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/stud1abc123',
    );
    expect(fetch.mock.calls[1]![1]!.method).toBe('PATCH');
  });
});

describe('Microsoft Calendar provider', () => {
  it('never sends an OAuth token to an off-origin delta cursor or pagination link', async () => {
    const cursorFetch = vi.fn<typeof globalThis.fetch>();
    const cursorProvider = createMicrosoftCalendarProvider({ fetch: cursorFetch });

    await expect(cursorProvider.sync({
      accessToken: 'secret-microsoft-token',
      calendarId: 'primary',
      cursor: 'https://attacker.example/collect-token',
    })).rejects.toThrow(/Microsoft Graph/i);
    expect(cursorFetch).not.toHaveBeenCalled();

    const pageFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({
        value: [],
        '@odata.nextLink': 'https://attacker.example/collect-token',
      }));
    const pageProvider = createMicrosoftCalendarProvider({ fetch: pageFetch });

    await expect(pageProvider.sync({
      accessToken: 'secret-microsoft-token',
      calendarId: 'primary',
      from: '2026-08-01T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    })).rejects.toThrow(/Microsoft Graph/i);
    expect(pageFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps Microsoft all-day events as calendar dates, never midnight instants', async () => {
    const deltaLink = 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=all-day';
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json({
      value: [{
        id: 'all-day-1',
        subject: 'Reading week',
        isAllDay: true,
        start: { dateTime: '2026-10-12T00:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-10-17T00:00:00.0000000', timeZone: 'UTC' },
      }],
      '@odata.deltaLink': deltaLink,
    }));
    const provider = createMicrosoftCalendarProvider({ fetch });

    const result = await provider.sync({
      accessToken: 'token',
      calendarId: 'primary',
      from: '2026-08-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    });

    expect(result.changes[0]).toMatchObject({
      operation: 'upsert',
      event: {
        allDay: true,
        start: '2026-10-12',
        end: '2026-10-17',
      },
    });
  });

  it('follows delta links and maps removals, change keys, and transaction IDs', async () => {
    const nextLink = 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=next';
    const deltaLink = 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=done';
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json({
          value: [
            {
              id: 'ms-1',
              changeKey: 'change-1',
              transactionId: 'local-transaction-1',
              showAs: 'free',
              subject: 'Lecture',
              start: { dateTime: '2026-09-01T10:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-09-01T11:00:00.0000000', timeZone: 'UTC' },
              isAllDay: false,
              lastModifiedDateTime: '2026-08-25T14:00:00Z',
            },
          ],
          '@odata.nextLink': nextLink,
        }),
      )
      .mockResolvedValueOnce(
        json({
          value: [{ id: 'ms-2', changeKey: 'change-2', '@removed': { reason: 'deleted' } }],
          '@odata.deltaLink': deltaLink,
        }),
      );

    const provider = createMicrosoftCalendarProvider({ fetch });
    const result = await provider.sync({
      accessToken: 'microsoft-token',
      calendarId: 'primary',
      from: '2026-08-01T00:00:00Z',
      to: '2026-10-01T00:00:00Z',
    });

    const firstUrl = new URL(String(fetch.mock.calls[0]![0]));
    expect(firstUrl.pathname).toBe('/v1.0/me/calendarView/delta');
    expect(firstUrl.searchParams.get('startDateTime')).toBe('2026-08-01T00:00:00Z');
    expect(firstUrl.searchParams.get('endDateTime')).toBe('2026-10-01T00:00:00Z');
    expect(fetch.mock.calls[1]![0]).toBe(nextLink);
    expect(result.cursor).toBe(deltaLink);
    expect(result.changes).toEqual([
      expect.objectContaining({
        operation: 'upsert',
        event: expect.objectContaining({
          remoteId: 'ms-1',
          changeKey: 'change-1',
          transactionId: 'local-transaction-1',
          busyStatus: 'free',
        }),
      }),
      { operation: 'delete', remoteId: 'ms-2', changeKey: 'change-2' },
    ]);
  });

  it('uses a saved delta link directly and sends transactionId on creates', async () => {
    const deltaLink = 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=old';
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ value: [], '@odata.deltaLink': deltaLink }))
      .mockResolvedValueOnce(json({ id: 'ms-new', changeKey: 'change-new' }, { status: 201 }));
    const provider = createMicrosoftCalendarProvider({ fetch });

    await provider.sync({ accessToken: 'token', calendarId: 'primary', cursor: deltaLink });
    await provider.upsert({
      accessToken: 'token',
      calendarId: 'primary',
      event: {
        localId: 'local-1',
        source: 'study_session',
        transactionId: 'tx-local-1',
        title: 'Study',
        start: '2026-09-01T15:00:00Z',
        end: '2026-09-01T15:30:00Z',
        allDay: false,
      },
    });

    expect(fetch.mock.calls[0]![0]).toBe(deltaLink);
    const createInit = fetch.mock.calls[1]![1]!;
    expect(createInit.method).toBe('POST');
    expect(JSON.parse(String(createInit.body))).toMatchObject({
      subject: 'Study',
      transactionId: 'tx-local-1',
      start: { dateTime: '2026-09-01T15:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-09-01T15:30:00Z', timeZone: 'UTC' },
    });
  });

  it('uses changeKey as the conditional version for updates and deletes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ id: 'ms-1', changeKey: 'change-2' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = createMicrosoftCalendarProvider({ fetch });

    await provider.upsert({
      accessToken: 'token',
      calendarId: 'work',
      remoteId: 'ms-1',
      changeKey: 'change-1',
      event: {
        localId: 'local-1',
        source: 'task_due',
        title: 'Essay',
        start: '2026-09-01T15:00:00Z',
        end: '2026-09-01T15:30:00Z',
        allDay: false,
      },
    });
    await provider.delete({
      accessToken: 'token',
      calendarId: 'work',
      remoteId: 'ms-1',
      changeKey: 'change-2',
    });

    expect(new Headers(fetch.mock.calls[0]![1]!.headers).get('if-match')).toBe('change-1');
    expect(new Headers(fetch.mock.calls[1]![1]!.headers).get('if-match')).toBe('change-2');
  });
});

describe('Clerk calendar token broker', () => {
  it('retrieves a fresh provider token on each request and enforces required scopes', async () => {
    const getUserOauthAccessToken = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ token: 'google-1', scopes: ['calendar.events'] }] })
      .mockResolvedValueOnce({ data: [{ token: 'google-2', scopes: ['calendar.events'] }] });
    const broker = createClerkCalendarTokenBroker({ users: { getUserOauthAccessToken } });

    await expect(broker.getAccessToken('user-1', 'google', ['calendar.events'])).resolves.toBe('google-1');
    await expect(broker.getAccessToken('user-1', 'google', ['calendar.events'])).resolves.toBe('google-2');
    expect(getUserOauthAccessToken).toHaveBeenNthCalledWith(1, 'user-1', 'google');
    expect(getUserOauthAccessToken).toHaveBeenNthCalledWith(2, 'user-1', 'google');
  });

  it('rejects missing tokens and tokens without all requested scopes', async () => {
    const missing = createClerkCalendarTokenBroker({
      users: { getUserOauthAccessToken: vi.fn().mockResolvedValue({ data: [] }) },
    });
    const underscoped = createClerkCalendarTokenBroker({
      users: {
        getUserOauthAccessToken: vi.fn().mockResolvedValue({
          data: [{ token: 'microsoft-token', scopes: ['Calendars.Read'] }],
        }),
      },
    });

    await expect(missing.getAccessToken('user-1', 'google')).rejects.toMatchObject({
      name: 'ProviderTokenUnavailableError',
      reason: 'missing_token',
    });
    await expect(
      underscoped.getAccessToken('user-1', 'microsoft', ['Calendars.Read', 'Calendars.ReadWrite']),
    ).rejects.toEqual(expect.any(ProviderTokenUnavailableError));
    await expect(
      underscoped.getAccessToken('user-1', 'microsoft', ['Calendars.ReadWrite']),
    ).rejects.toMatchObject({ reason: 'missing_scopes' });
  });
});
