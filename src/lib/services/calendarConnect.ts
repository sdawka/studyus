import { and, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { calendarConnections, calendarProviderCalendars, calendarProvisionLedger, studySessions, users } from '../../db/schema';
import { bearerHeaders, readJson } from '../calendar/providers/http';
import { createGoogleCalendarProvider, createMicrosoftCalendarProvider, type CalendarProviderAdapter, type CalendarProviderName, type CalendarTokenBroker, type ProvisionedCalendar } from '../calendar/providers';
import { createCalendarConnection, enqueueCalendarOperation, registerProviderCalendar } from './calendarSync';
import { ConflictError, NotFoundError, runBatch } from './util';
import {assertCalendarActive} from './calendarActive';

export const CALENDAR_PROVIDER_SCOPES: Record<CalendarProviderName, readonly string[]> = {
  google: [
    'https://www.googleapis.com/auth/calendar.events.readonly',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.app.created',
  ],
  microsoft: ['Calendars.ReadWrite'],
};
const PROVISION_LEASE_MS = 5 * 60_000;

interface ConnectDependencies {
  fetch: typeof globalThis.fetch;
  tokenBroker: CalendarTokenBroker;
  timezone: string;
}

interface CalendarBootstrap {
  accountId: string;
  primary: BootstrapCalendar;
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
): Promise<(BootstrapCalendar & { connectionId: string }) | undefined> {
  const [calendar] = await db
    .select({
      id: calendarProviderCalendars.providerCalendarId,
      connectionId: calendarConnections.id,
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
): Promise<CalendarBootstrap> {
  const headers = bearerHeaders(accessToken);
  const list = await readJson<{
    items?: Array<{ id: string; summary?: string; primary?: boolean; timeZone?: string; accessRole?: string }>;
  }>(await deps.fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers }));
  const primary = list.items?.find((calendar) => calendar.primary) ?? list.items?.[0];
  if (!primary) throw new Error('Google Calendar did not return a primary calendar');
  return {
    accountId,
    primary: {
      id: primary.id,
      name: primary.summary ?? 'Primary',
      timezone: primary.timeZone ?? deps.timezone,
      accessRole: primary.accessRole ?? null,
    },
  };
}

async function bootstrapMicrosoft(
  accessToken: string,
  deps: ConnectDependencies,
  accountId: string,
): Promise<CalendarBootstrap> {
  const headers = bearerHeaders(accessToken);
  const primary = await readJson<{ id: string; name?: string }>(
    await deps.fetch('https://graph.microsoft.com/v1.0/me/calendar?$select=id,name', { headers }),
  );
  return {
    accountId,
    primary: { id: primary.id, name: primary.name ?? 'Primary', timezone: deps.timezone, accessRole: 'read' },
  };
}

function provisioningAdapter(provider: CalendarProviderName, fetch: typeof globalThis.fetch): CalendarProviderAdapter {
  return provider === 'google' ? createGoogleCalendarProvider({ fetch }) : createMicrosoftCalendarProvider({ fetch });
}

function asBootstrapCalendar(calendar: ProvisionedCalendar): BootstrapCalendar {
  return { id: calendar.id, name: calendar.name, timezone: calendar.timezone, accessRole: calendar.accessRole };
}

async function claimProvision(db: Db, userId: string, provider: CalendarProviderName, externalAccountId: string, now: number) {
  const leaseToken = crypto.randomUUID();
  await db.insert(calendarProvisionLedger).values({
    id: crypto.randomUUID(), userId, provider, externalAccountId, marker: crypto.randomUUID(), state: 'pending',
    attemptCount: 0, updatedAt: now, createdAt: now,
  }).onConflictDoNothing();
  const ledger = (await db.select().from(calendarProvisionLedger).where(and(
    eq(calendarProvisionLedger.userId, userId), eq(calendarProvisionLedger.provider, provider), eq(calendarProvisionLedger.externalAccountId, externalAccountId),
  )).limit(1))[0];
  if (!ledger) throw new ConflictError('Calendar provision ledger is unavailable');
  if (ledger.state === 'persisted' && ledger.connectionId && ledger.remoteCalendarId) return { ledger, leaseToken: null };
  if (ledger.leaseToken && ledger.leaseExpiresAt !== null && ledger.leaseExpiresAt > now) throw new ConflictError('Calendar provisioning is already in progress');
  const claimed = await db.update(calendarProvisionLedger).set({
    leaseToken, leaseExpiresAt: now + PROVISION_LEASE_MS, attemptCount: sql`${calendarProvisionLedger.attemptCount} + 1`, updatedAt: now,
  }).where(and(
    eq(calendarProvisionLedger.id, ledger.id),
    or(isNull(calendarProvisionLedger.leaseToken), isNull(calendarProvisionLedger.leaseExpiresAt), lte(calendarProvisionLedger.leaseExpiresAt, now)),
  )).returning();
  if (!claimed[0]) throw new ConflictError('Calendar provisioning changed before it could be claimed');
  return { ledger: claimed[0], leaseToken };
}

async function recordLegacyProvision(
  db: Db, userId: string, provider: CalendarProviderName, externalAccountId: string,
  existing: BootstrapCalendar & { connectionId: string }, now: number,
) {
  await db.insert(calendarProvisionLedger).values({
    id: crypto.randomUUID(), userId, provider, externalAccountId, marker: crypto.randomUUID(), remoteCalendarId: existing.id,
    connectionId: existing.connectionId, state: 'persisted', updatedAt: now, createdAt: now,
  }).onConflictDoUpdate({
    target: [calendarProvisionLedger.userId, calendarProvisionLedger.provider, calendarProvisionLedger.externalAccountId],
    set: { remoteCalendarId: existing.id, connectionId: existing.connectionId, state: 'persisted', leaseToken: null, leaseExpiresAt: null, lastError: null, updatedAt: now },
  });
  return existing;
}

async function provisionStudyusCalendar(
  db: Db, userId: string, provider: CalendarProviderName, externalAccountId: string,
  adapter: CalendarProviderAdapter, accessToken: string, timezone: string, now: number,
) {
  if (!adapter.provisionCalendar || !adapter.discoverProvisionedCalendar || !adapter.deleteProvisionedCalendar) {
    throw new Error(`Calendar provider ${provider} does not support Studyus calendar provisioning`);
  }
  const claim = await claimProvision(db, userId, provider, externalAccountId, now);
  if (!claim.leaseToken) {
    const discovered = await adapter.discoverProvisionedCalendar({ accessToken, marker: claim.ledger.marker });
    if (!discovered) throw new ConflictError('Persisted Studyus calendar is missing remotely');
    return { studyus: asBootstrapCalendar(discovered), ledgerId: claim.ledger.id, leaseToken: null, compensatable: false };
  }
  let provisioned = await adapter.discoverProvisionedCalendar({ accessToken, marker: claim.ledger.marker });
  if (!provisioned) provisioned = await adapter.provisionCalendar({ accessToken, marker: claim.ledger.marker, timezone });
  const written = await db.update(calendarProvisionLedger).set({
    remoteCalendarId: provisioned.id, state: 'remote_created', lastError: null, updatedAt: now,
  }).where(and(eq(calendarProvisionLedger.id, claim.ledger.id), eq(calendarProvisionLedger.leaseToken, claim.leaseToken))).returning();
  if (!written[0]) throw new ConflictError('Calendar provision changed before remote identity was recorded');
  return { studyus: asBootstrapCalendar(provisioned), ledgerId: claim.ledger.id, leaseToken: claim.leaseToken, compensatable: true };
}

async function compensateProvision(
  db: Db, ledgerId: string, leaseToken: string, calendarId: string, adapter: CalendarProviderAdapter,
  accessToken: string, now: number, cause: unknown,
) {
  try {
    await adapter.deleteProvisionedCalendar!({ accessToken, calendarId });
    await db.update(calendarProvisionLedger).set({
      state: 'pending', remoteCalendarId: null, leaseToken: null, leaseExpiresAt: null,
      lastError: cause instanceof Error ? cause.message : String(cause), updatedAt: now,
    }).where(and(eq(calendarProvisionLedger.id, ledgerId), eq(calendarProvisionLedger.leaseToken, leaseToken)));
  } catch (cleanupError) {
    await db.update(calendarProvisionLedger).set({
      state: 'cleanup_failed', lastError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), updatedAt: now,
    }).where(and(eq(calendarProvisionLedger.id, ledgerId), eq(calendarProvisionLedger.leaseToken, leaseToken)));
  }
}

export async function connectCalendarProvider(
  db: Db,
  userId: string,
  clerkUserId: string,
  provider: CalendarProviderName,
  deps: ConnectDependencies,
) {
  const providerFetch=deps.fetch;
  deps={...deps,fetch:async(input,init)=>{
    await assertCalendarActive(db,userId);
    const response=await providerFetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(30_000),...(init?.signal?[init.signal]:[])])});
    await assertCalendarActive(db,userId);
    return response;
  }};
  const account = (await db.select({ state: users.accountState }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!account || account.state !== 'active') throw new NotFoundError('Calendar owner');
  const now = Date.now();
  const accessToken = await deps.tokenBroker.getAccessToken(clerkUserId, provider, CALENDAR_PROVIDER_SCOPES[provider]);
  const accountId = await getProviderAccountId(accessToken, provider, deps);
  const existingStudyus = await findOwnedStudyusCalendar(db, userId, provider, accountId);
  const adapter = provisioningAdapter(provider, deps.fetch);
  const bootstrap = provider === 'google'
    ? await bootstrapGoogle(accessToken, deps, accountId)
    : await bootstrapMicrosoft(accessToken, deps, accountId);
  const provision = existingStudyus
    ? { studyus: await recordLegacyProvision(db, userId, provider, accountId, existingStudyus, now), ledgerId: null, leaseToken: null, compensatable: false }
    : await provisionStudyusCalendar(db, userId, provider, accountId, adapter, accessToken, deps.timezone, now);

  let connection: Awaited<ReturnType<typeof createCalendarConnection>>;
  let primary: Awaited<ReturnType<typeof registerProviderCalendar>>;
  let studyus: Awaited<ReturnType<typeof registerProviderCalendar>>;
  try {
    const connectionId = crypto.randomUUID();
    const connectionLookup = sql`SELECT id FROM calendar_connections WHERE user_id=${userId} AND provider=${provider} AND external_account_id=${bootstrap.accountId}`;
    const statements = [
      db.insert(calendarConnections).values({id:connectionId,userId,provider,externalAccountId:bootstrap.accountId,syncMode:'controlled',status:'active',updatedAt:now,createdAt:now})
        .onConflictDoUpdate({target:[calendarConnections.userId,calendarConnections.provider,calendarConnections.externalAccountId],set:{syncMode:'controlled',status:'active',lastError:null,updatedAt:now}}),
      ...[{calendar:bootstrap.primary,owned:false},{calendar:provision.studyus,owned:true}].map(({calendar,owned})=>db.insert(calendarProviderCalendars).values({
        id:crypto.randomUUID(),connectionId:sql`(${connectionLookup})`,providerCalendarId:calendar.id,name:calendar.name,timezone:calendar.timezone,
        selected:true,studyusOwned:owned,accessRole:calendar.accessRole,updatedAt:now,createdAt:now,
      }).onConflictDoUpdate({target:[calendarProviderCalendars.connectionId,calendarProviderCalendars.providerCalendarId],set:{name:calendar.name,timezone:calendar.timezone,selected:true,studyusOwned:owned,accessRole:calendar.accessRole,updatedAt:now}})),
      ...(provision.ledgerId && provision.leaseToken ? [db.update(calendarProvisionLedger).set({
        marker:sql`CASE WHEN lease_token=${provision.leaseToken} THEN marker ELSE NULL END`,connectionId:sql`(${connectionLookup})`,
        state:'persisted',leaseToken:null,leaseExpiresAt:null,lastError:null,updatedAt:now,
      }).where(eq(calendarProvisionLedger.id,provision.ledgerId))] : []),
    ];
    await runBatch(db,statements);
    connection=(await db.select().from(calendarConnections).where(and(eq(calendarConnections.userId,userId),eq(calendarConnections.provider,provider),eq(calendarConnections.externalAccountId,bootstrap.accountId))).limit(1))[0];
    const registered=await db.select().from(calendarProviderCalendars).where(eq(calendarProviderCalendars.connectionId,connection.id));
    primary=registered.find(calendar=>calendar.providerCalendarId===bootstrap.primary.id)!;
    studyus=registered.find(calendar=>calendar.providerCalendarId===provision.studyus.id)!;

  } catch (error) {
    if (provision.compensatable && provision.ledgerId && provision.leaseToken) {
      await compensateProvision(db, provision.ledgerId, provision.leaseToken, provision.studyus.id, adapter, accessToken, now, error);
    }
    throw error;
  }
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
