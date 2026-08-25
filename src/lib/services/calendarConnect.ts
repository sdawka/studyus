import { and, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { calendarConnections, calendarProviderCalendars, studySessions } from '../../db/schema';
import { bearerHeaders, readJson } from '../calendar/providers/http';
import type { CalendarProviderName, CalendarTokenBroker } from '../calendar/providers';
import { createCalendarConnection, enqueueCalendarOperation, registerProviderCalendar } from './calendarSync';

export const CALENDAR_PROVIDER_SCOPES: Record<CalendarProviderName, readonly string[]> = {
  google: [
    'https://www.googleapis.com/auth/calendar.events.readonly',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.app.created',
  ],
  microsoft: ['Calendars.ReadWrite'],
};

interface ConnectDependencies {
  fetch: typeof globalThis.fetch;
  tokenBroker: CalendarTokenBroker;
  timezone: string;
}

interface CalendarBootstrap {
  accountId: string;
  primary: BootstrapCalendar;
  studyus: BootstrapCalendar;
}

interface BootstrapCalendar {
  id: string;
  name: string;
  timezone: string | null;
  accessRole: string | null;
}

async function getProviderAccountId(
  accessToken: string,
  provider: CalendarProviderName,
  deps: ConnectDependencies,
): Promise<string> {
  const headers = bearerHeaders(accessToken);
  const url = provider === 'google'
    ? 'https://www.googleapis.com/oauth2/v2/userinfo'
    : 'https://graph.microsoft.com/v1.0/me?$select=id';
  const account = await readJson<{ id: string }>(await deps.fetch(url, { headers }));
  return account.id;
}

async function findOwnedStudyusCalendar(
  db: Db,
  userId: string,
  provider: CalendarProviderName,
  accountId: string,
): Promise<BootstrapCalendar | undefined> {
  const [calendar] = await db
    .select({
      id: calendarProviderCalendars.providerCalendarId,
      name: calendarProviderCalendars.name,
      timezone: calendarProviderCalendars.timezone,
      accessRole: calendarProviderCalendars.accessRole,
    })
    .from(calendarProviderCalendars)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarProviderCalendars.connectionId))
    .where(and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, provider),
      eq(calendarConnections.externalAccountId, accountId),
      eq(calendarProviderCalendars.studyusOwned, true),
    ))
    .limit(1);
  return calendar;
}

async function bootstrapGoogle(
  accessToken: string,
  deps: ConnectDependencies,
  accountId: string,
  existingStudyus?: BootstrapCalendar,
): Promise<CalendarBootstrap> {
  const headers = bearerHeaders(accessToken);
  const list = await readJson<{
    items?: Array<{ id: string; summary?: string; primary?: boolean; timeZone?: string; accessRole?: string }>;
  }>(await deps.fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers }));
  const primary = list.items?.find((calendar) => calendar.primary) ?? list.items?.[0];
  if (!primary) throw new Error('Google Calendar did not return a primary calendar');
  const createdStudyus = existingStudyus ? undefined : await readJson<{ id: string; summary?: string; timeZone?: string }>(
    await deps.fetch('https://www.googleapis.com/calendar/v3/calendars', {
      method: 'POST',
      headers: bearerHeaders(accessToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ summary: 'Studyus', description: 'Study blocks managed by Studyus', timeZone: deps.timezone }),
    }),
  );
  const studyus: BootstrapCalendar = existingStudyus ?? {
    id: createdStudyus!.id,
    name: createdStudyus!.summary ?? 'Studyus',
    timezone: createdStudyus!.timeZone ?? deps.timezone,
    accessRole: 'owner',
  };
  return {
    accountId,
    primary: {
      id: primary.id,
      name: primary.summary ?? 'Primary',
      timezone: primary.timeZone ?? deps.timezone,
      accessRole: primary.accessRole ?? null,
    },
    studyus,
  };
}

async function bootstrapMicrosoft(
  accessToken: string,
  deps: ConnectDependencies,
  accountId: string,
  existingStudyus?: BootstrapCalendar,
): Promise<CalendarBootstrap> {
  const headers = bearerHeaders(accessToken);
  const primary = await readJson<{ id: string; name?: string }>(
    await deps.fetch('https://graph.microsoft.com/v1.0/me/calendar?$select=id,name', { headers }),
  );
  const createdStudyus = existingStudyus ? undefined : await readJson<{ id: string; name?: string }>(
    await deps.fetch('https://graph.microsoft.com/v1.0/me/calendars', {
      method: 'POST',
      headers: bearerHeaders(accessToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ name: 'Studyus' }),
    }),
  );
  const studyus: BootstrapCalendar = existingStudyus ?? {
    id: createdStudyus!.id,
    name: createdStudyus!.name ?? 'Studyus',
    timezone: deps.timezone,
    accessRole: 'owner',
  };
  return {
    accountId,
    primary: { id: primary.id, name: primary.name ?? 'Primary', timezone: deps.timezone, accessRole: 'read' },
    studyus,
  };
}

export async function connectCalendarProvider(
  db: Db,
  userId: string,
  clerkUserId: string,
  provider: CalendarProviderName,
  deps: ConnectDependencies,
) {
  const accessToken = await deps.tokenBroker.getAccessToken(clerkUserId, provider, CALENDAR_PROVIDER_SCOPES[provider]);
  const accountId = await getProviderAccountId(accessToken, provider, deps);
  const existingStudyus = await findOwnedStudyusCalendar(db, userId, provider, accountId);
  const bootstrap = provider === 'google'
    ? await bootstrapGoogle(accessToken, deps, accountId, existingStudyus)
    : await bootstrapMicrosoft(accessToken, deps, accountId, existingStudyus);
  const connection = await createCalendarConnection(db, userId, {
    provider,
    external_account_id: bootstrap.accountId,
    sync_mode: 'controlled',
  });

  const primary = await registerProviderCalendar(db, userId, connection.id, {
    provider_calendar_id: bootstrap.primary.id,
    name: bootstrap.primary.name,
    timezone: bootstrap.primary.timezone,
    access_role: bootstrap.primary.accessRole,
    selected: true,
    studyus_owned: false,
  });
  const studyus = await registerProviderCalendar(db, userId, connection.id, {
    provider_calendar_id: bootstrap.studyus.id,
    name: bootstrap.studyus.name,
    timezone: bootstrap.studyus.timezone,
    access_role: bootstrap.studyus.accessRole,
    selected: true,
    studyus_owned: true,
  });
  const plannedSessions = await db
    .select({ id: studySessions.id, scheduledAt: studySessions.scheduledAt, plannedMinutes: studySessions.plannedMinutes })
    .from(studySessions)
    .where(and(
      eq(studySessions.userId, userId),
      isNotNull(studySessions.scheduledAt),
      isNull(studySessions.endedAt),
      gte(studySessions.scheduledAt, Date.now()),
    ));
  await Promise.all(plannedSessions.map((session) => enqueueCalendarOperation(db, userId, connection.id, {
    action: 'upsert',
    entity_type: 'study_session',
    entity_id: session.id,
    revision: `${session.scheduledAt}:${session.plannedMinutes ?? 'default'}`,
  })));
  return {
    id: connection.id,
    provider: connection.provider,
    status: connection.status,
    calendar_count: 2,
    calendars: [primary, studyus],
  };
}

export async function listCalendarConnections(db: Db, userId: string) {
  const rows = await db
    .select({ connection: calendarConnections, calendar: calendarProviderCalendars })
    .from(calendarConnections)
    .leftJoin(calendarProviderCalendars, eq(calendarProviderCalendars.connectionId, calendarConnections.id))
    .where(eq(calendarConnections.userId, userId));
  const grouped = new Map<string, { id: string; provider: CalendarProviderName; status: string; sync_mode: string; calendars: unknown[] }>();
  for (const row of rows) {
    const entry = grouped.get(row.connection.id) ?? {
      id: row.connection.id,
      provider: row.connection.provider,
      status: row.connection.status,
      sync_mode: row.connection.syncMode,
      calendars: [],
    };
    if (row.calendar) {
      entry.calendars.push({
        id: row.calendar.id,
        name: row.calendar.name,
        selected: row.calendar.selected,
        studyus_owned: row.calendar.studyusOwned,
        timezone: row.calendar.timezone,
      });
    }
    grouped.set(row.connection.id, entry);
  }
  return [...grouped.values()];
}

export async function disconnectCalendarProvider(db: Db, userId: string, connectionId: string): Promise<void> {
  await db
    .delete(calendarConnections)
    .where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.userId, userId)));
}
