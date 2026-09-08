import { bearerHeaders, expectSuccess, readJson } from './http';
import type {
  CalendarProviderAdapter,
  ProviderChange,
  ProviderEvent,
  ProviderEventInput,
  ProviderEventVersion,
  ProvisionedCalendar,
  ProviderCalendarDeleteRequest,
  ProviderCalendarDiscoveryRequest,
  ProviderCalendarProvisionRequest,
  ProviderSyncRequest,
} from './types';

const MICROSOFT_GRAPH_API = 'https://graph.microsoft.com/v1.0';
const MICROSOFT_GRAPH_ORIGIN = 'https://graph.microsoft.com';
export const MICROSOFT_STUDYUS_MARKER_PROPERTY = 'String {8d8156d3-7e51-4e7c-84e0-55c491034e87} Name StudyusProvision';

interface MicrosoftEvent {
  id: string;
  subject?: string;
  changeKey?: string;
  transactionId?: string;
  isAllDay?: boolean;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  lastModifiedDateTime?: string;
  showAs?: string;
  '@removed'?: { reason?: string };
}

function microsoftBusyStatus(showAs: string | undefined): ProviderEvent['busyStatus'] {
  if (showAs === 'free') return 'free';
  if (showAs === 'tentative') return 'tentative';
  if (showAs === 'oof') return 'out_of_office';
  return 'busy';
}

interface MicrosoftEventsPage {
  value?: MicrosoftEvent[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

interface MicrosoftCalendar {
  id: string;
  name?: string;
  canEdit?: boolean;
}

function calendarBase(calendarId: string): string {
  return calendarId === 'primary'
    ? `${MICROSOFT_GRAPH_API}/me`
    : `${MICROSOFT_GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}`;
}

function initialDeltaUrl(request: ProviderSyncRequest): string {
  const url = new URL(`${calendarBase(request.calendarId)}/calendarView/delta`);
  if (!request.from || !request.to) {
    throw new Error('Microsoft Calendar initial sync requires from and to');
  }
  url.searchParams.set('startDateTime', request.from);
  url.searchParams.set('endDateTime', request.to);
  return url.toString();
}

function microsoftCalendar(value: MicrosoftCalendar, fallbackTimezone = 'UTC'): ProvisionedCalendar {
  return { id: value.id, name: value.name ?? 'Studyus', timezone: fallbackTimezone, accessRole: value.canEdit === false ? 'read' : 'owner' };
}

/** Delta links are opaque, but never trusted as bearer-token destinations. */
function assertMicrosoftGraphUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Microsoft Graph returned an invalid delta URL');
  }
  if (url.origin !== MICROSOFT_GRAPH_ORIGIN || !url.pathname.startsWith('/v1.0/me/')) {
    throw new Error('Microsoft Graph delta URL must stay on the Microsoft Graph API origin');
  }
  return url.toString();
}

function mapMicrosoftEvent(event: MicrosoftEvent): ProviderChange {
  if (event['@removed']) {
    return {
      operation: 'delete',
      remoteId: event.id,
      ...(event.changeKey ? { changeKey: event.changeKey } : {}),
    };
  }

  const start = event.start?.dateTime;
  const end = event.end?.dateTime;
  if (!start || !end) throw new Error(`Microsoft Calendar event ${event.id} is missing its start or end`);
  const allDay = event.isAllDay ?? false;
  const timezone = event.start?.timeZone ?? 'UTC';
  // Graph's dateTimeTimeZone commonly returns a zone-less local datetime.
  // With `UTC`, make the instant explicit before it crosses the adapter.
  // All-day values are calendar dates, not midnight instants; retain only the
  // date portion so no later timezone conversion can move them a day.
  const normalizedStart = allDay
    ? start.slice(0, 10)
    : timezone.toUpperCase() === 'UTC' && !/(?:Z|[+-]\d\d:\d\d)$/i.test(start) ? `${start}Z` : start;
  const normalizedEnd = allDay
    ? end.slice(0, 10)
    : timezone.toUpperCase() === 'UTC' && !/(?:Z|[+-]\d\d:\d\d)$/i.test(end) ? `${end}Z` : end;
  const mapped: ProviderEvent = {
    remoteId: event.id,
    title: event.subject ?? '',
    start: normalizedStart,
    end: normalizedEnd,
    allDay,
    timezone,
    updatedAt: event.lastModifiedDateTime ?? null,
    localId: null,
    source: null,
    busyStatus: microsoftBusyStatus(event.showAs),
    ...(event.changeKey ? { changeKey: event.changeKey } : {}),
    ...(event.transactionId ? { transactionId: event.transactionId } : {}),
  };
  return { operation: 'upsert', event: mapped };
}

function microsoftWriteBody(event: ProviderEventInput) {
  return {
    subject: event.title,
    ...(event.description === undefined
      ? {}
      : { body: { contentType: 'text', content: event.description } }),
    ...(event.location === undefined ? {} : { location: { displayName: event.location } }),
    start: { dateTime: event.start, timeZone: 'UTC' },
    end: { dateTime: event.end, timeZone: 'UTC' },
    isAllDay: event.allDay,
    ...(event.transactionId ? { transactionId: event.transactionId } : {}),
  };
}

export function createMicrosoftCalendarProvider({ fetch }: { fetch: typeof globalThis.fetch }): CalendarProviderAdapter {
  return {
    name: 'microsoft',

    async sync(request: ProviderSyncRequest) {
      const changes: ProviderChange[] = [];
      let url: string | undefined = request.cursor ?? initialDeltaUrl(request);
      let cursor: string | undefined;

      while (url) {
        url = assertMicrosoftGraphUrl(url);
        const page: MicrosoftEventsPage = await readJson<MicrosoftEventsPage>(
          await fetch(url, { headers: bearerHeaders(request.accessToken) }),
        );
        changes.push(...(page.value ?? []).map(mapMicrosoftEvent));
        cursor = page['@odata.deltaLink'] ?? cursor;
        url = page['@odata.nextLink'];
      }

      if (!cursor) throw new Error('Microsoft Calendar sync completed without an @odata.deltaLink');
      return { changes, cursor };
    },

    async upsert(request) {
      const baseUrl = `${calendarBase(request.calendarId)}/events`;
      const url = request.remoteId ? `${baseUrl}/${encodeURIComponent(request.remoteId)}` : baseUrl;
      const headers = bearerHeaders(request.accessToken, { 'content-type': 'application/json' });
      if (request.changeKey) headers.set('if-match', request.changeKey);
      const result = await readJson<MicrosoftEvent>(
        await fetch(url, {
          method: request.remoteId ? 'PATCH' : 'POST',
          headers,
          body: JSON.stringify(microsoftWriteBody(request.event)),
        }),
      );
      const version: ProviderEventVersion = {
        remoteId: result.id,
        ...(result.changeKey ? { changeKey: result.changeKey } : {}),
      };
      return version;
    },

    async delete(request) {
      const headers = bearerHeaders(request.accessToken);
      if (request.changeKey) headers.set('if-match', request.changeKey);
      await expectSuccess(
        await fetch(`${calendarBase(request.calendarId)}/events/${encodeURIComponent(request.remoteId)}`, {
          method: 'DELETE',
          headers,
        }),
      );
    },

    async provisionCalendar(request: ProviderCalendarProvisionRequest) {
      const response = await fetch(`${MICROSOFT_GRAPH_API}/me/calendars`, {
        method: 'POST',
        headers: bearerHeaders(request.accessToken, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          name: 'Studyus',
          singleValueExtendedProperties: [{ id: MICROSOFT_STUDYUS_MARKER_PROPERTY, value: request.marker }],
        }),
      });
      return microsoftCalendar(await readJson<MicrosoftCalendar>(response), request.timezone);
    },

    async discoverProvisionedCalendar(request: ProviderCalendarDiscoveryRequest) {
      const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendars`);
      url.searchParams.set('$filter', `singleValueExtendedProperties/Any(ep: ep/id eq '${MICROSOFT_STUDYUS_MARKER_PROPERTY}' and ep/value eq '${request.marker}')`);
      const response = await readJson<{ value?: MicrosoftCalendar[] }>(
        await fetch(url.toString(), { headers: bearerHeaders(request.accessToken) }),
      );
      return response.value?.[0] ? microsoftCalendar(response.value[0]) : null;
    },

    async deleteProvisionedCalendar(request: ProviderCalendarDeleteRequest) {
      await expectSuccess(await fetch(`${MICROSOFT_GRAPH_API}/me/calendars/${encodeURIComponent(request.calendarId)}`, {
        method: 'DELETE',
        headers: bearerHeaders(request.accessToken),
      }));
    },
  };
}
