import { bearerHeaders, expectSuccess, readJson } from './http';
import type {
  CalendarProviderAdapter,
  ProviderChange,
  ProviderEvent,
  ProviderEventInput,
  ProviderEventVersion,
  ProviderSyncRequest,
} from './types';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const GOOGLE_STUDYUS_EVENT_ID = 'studyus_event_id';
export const GOOGLE_STUDYUS_SOURCE = 'studyus_source';

interface GoogleEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  updated?: string;
  transparency?: 'opaque' | 'transparent';
  extendedProperties?: {
    private?: Record<string, string>;
  };
}

interface GoogleEventsPage {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface GoogleWriteResponse {
  id: string;
  etag?: string;
}

function eventsUrl(calendarId: string): URL {
  return new URL(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
}

function mapGoogleEvent(event: GoogleEvent): ProviderChange {
  if (event.status === 'cancelled') {
    return { operation: 'delete', remoteId: event.id, ...(event.etag ? { etag: event.etag } : {}) };
  }

  const start = event.start?.dateTime ?? event.start?.date;
  const end = event.end?.dateTime ?? event.end?.date;
  if (!start || !end) throw new Error(`Google Calendar event ${event.id} is missing its start or end`);

  const privateProperties = event.extendedProperties?.private;
  const mapped: ProviderEvent = {
    remoteId: event.id,
    title: event.summary ?? '',
    start,
    end,
    allDay: Boolean(event.start?.date),
    timezone: event.start?.timeZone ?? 'UTC',
    updatedAt: event.updated ?? null,
    localId: privateProperties?.[GOOGLE_STUDYUS_EVENT_ID] ?? null,
    source: privateProperties?.[GOOGLE_STUDYUS_SOURCE] ?? null,
    busyStatus: event.transparency === 'transparent' ? 'free' : 'busy',
    ...(event.etag ? { etag: event.etag } : {}),
  };
  return { operation: 'upsert', event: mapped };
}

function googleWriteBody(event: ProviderEventInput, includeCreateId: boolean) {
  return {
    ...(includeCreateId && event.transactionId ? { id: event.transactionId } : {}),
    summary: event.title,
    ...(event.description === undefined ? {} : { description: event.description }),
    ...(event.location === undefined ? {} : { location: event.location }),
    start: event.allDay ? { date: event.start } : { dateTime: event.start },
    end: event.allDay ? { date: event.end } : { dateTime: event.end },
    extendedProperties: {
      private: {
        [GOOGLE_STUDYUS_EVENT_ID]: event.localId,
        [GOOGLE_STUDYUS_SOURCE]: event.source,
      },
    },
  };
}

export function createGoogleCalendarProvider({ fetch }: { fetch: typeof globalThis.fetch }): CalendarProviderAdapter {
  return {
    name: 'google',

    async sync(request: ProviderSyncRequest) {
      const changes: ProviderChange[] = [];
      const initialUrl = eventsUrl(request.calendarId);
      initialUrl.searchParams.set('showDeleted', 'true');
      initialUrl.searchParams.set('singleEvents', 'true');
      initialUrl.searchParams.set('maxResults', '2500');
      if (request.cursor) {
        initialUrl.searchParams.set('syncToken', request.cursor);
      } else {
        if (request.from) initialUrl.searchParams.set('timeMin', request.from);
        if (request.to) initialUrl.searchParams.set('timeMax', request.to);
      }

      let url = initialUrl.toString();
      let cursor: string | undefined;
      while (url) {
        const page = await readJson<GoogleEventsPage>(
          await fetch(url, { headers: bearerHeaders(request.accessToken) }),
        );
        changes.push(...(page.items ?? []).map(mapGoogleEvent));
        cursor = page.nextSyncToken ?? cursor;
        if (!page.nextPageToken) break;
        const nextUrl = new URL(initialUrl);
        nextUrl.searchParams.set('pageToken', page.nextPageToken);
        url = nextUrl.toString();
      }

      if (!cursor) throw new Error('Google Calendar sync completed without a nextSyncToken');
      return { changes, cursor };
    },

    async upsert(request) {
      let url = request.remoteId
        ? `${eventsUrl(request.calendarId)}/${encodeURIComponent(request.remoteId)}`
        : eventsUrl(request.calendarId).toString();
      const headers = bearerHeaders(request.accessToken, { 'content-type': 'application/json' });
      if (request.etag) headers.set('if-match', request.etag);
      let response = await fetch(url, {
        method: request.remoteId ? 'PATCH' : 'POST',
        headers,
        body: JSON.stringify(googleWriteBody(request.event, !request.remoteId)),
      });
      // A create may have reached Google before the worker persisted its local
      // link. The deterministic event ID turns that ambiguous retry into a
      // conflict; patching that exact ID completes the same logical upsert
      // without creating a second event.
      if (!request.remoteId && request.event.transactionId && response.status === 409) {
        url = `${eventsUrl(request.calendarId)}/${encodeURIComponent(request.event.transactionId)}`;
        response = await fetch(url, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(googleWriteBody(request.event, false)),
        });
      }
      const result = await readJson<GoogleWriteResponse>(response);
      const version: ProviderEventVersion = {
        remoteId: result.id,
        ...(result.etag ? { etag: result.etag } : {}),
      };
      return version;
    },

    async delete(request) {
      const headers = bearerHeaders(request.accessToken);
      if (request.etag) headers.set('if-match', request.etag);
      await expectSuccess(
        await fetch(`${eventsUrl(request.calendarId)}/${encodeURIComponent(request.remoteId)}`, {
          method: 'DELETE',
          headers,
        }),
      );
    },
  };
}
