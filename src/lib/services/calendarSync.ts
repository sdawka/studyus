import { and, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import {
  calendarConnections,
  calendarEventLinks,
  calendarExternalEvents,
  calendarOutbox,
  calendarProviderCalendars,
  calendarSyncStates,
  studySessions,
} from '../../db/schema';
import { runBatch } from './util';

type Provider = 'google' | 'microsoft';
type SyncMode = 'read' | 'controlled';
type LocalEntityType = 'study_session' | 'task' | 'assessment' | 'class_session';
type BusyStatus = 'free' | 'tentative' | 'busy' | 'out_of_office';

interface CalendarConnectionInput {
  provider: Provider;
  external_account_id: string;
  sync_mode: SyncMode;
}

interface ProviderCalendarInput {
  provider_calendar_id: string;
  name: string;
  timezone?: string | null;
  selected?: boolean;
  studyus_owned?: boolean;
  access_role?: string | null;
}

type ProviderTime =
  | { kind: 'timed'; at: string; timezone: string }
  | { kind: 'date'; date: string };

interface ProviderEventUpsert {
  type: 'upsert';
  provider_event_id: string;
  provider_version?: string | null;
  ical_uid?: string | null;
  recurring_event_id?: string | null;
  title: string;
  start: ProviderTime;
  end: ProviderTime;
  busy_status: BusyStatus;
  status?: 'confirmed' | 'tentative';
  recurrence?: string[] | null;
}

interface ProviderEventDelete {
  type: 'delete';
  provider_event_id: string;
  provider_version?: string | null;
}

export type ProviderEventChange = ProviderEventUpsert | ProviderEventDelete;

function requiredText(value: string, field: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${field} is required`);
  return result;
}

function parseInstant(value: string, field: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`${field} must be an ISO datetime`);
  return result;
}

function dateValue(value: ProviderTime): { at: number | null; date: string | null; timezone: string | null } {
  return value.kind === 'timed'
    ? { at: parseInstant(value.at, 'event time'), date: null, timezone: requiredText(value.timezone, 'timezone') }
    : { at: null, date: requiredText(value.date, 'date'), timezone: null };
}

async function assertCalendarOwnership(db: Db, userId: string, providerCalendarId: string) {
  const [result] = await db
    .select({ calendar: calendarProviderCalendars, connection: calendarConnections })
    .from(calendarProviderCalendars)
    .innerJoin(calendarConnections, eq(calendarProviderCalendars.connectionId, calendarConnections.id))
    .where(and(eq(calendarProviderCalendars.id, providerCalendarId), eq(calendarConnections.userId, userId)))
    .limit(1);
  if (!result) throw new Error('Calendar not found');
  return result;
}

export async function createCalendarConnection(db: Db, userId: string, input: CalendarConnectionInput) {
  const externalAccountId = requiredText(input.external_account_id, 'external_account_id');
  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .insert(calendarConnections)
    .values({
      id,
      userId,
      provider: input.provider,
      externalAccountId,
      syncMode: input.sync_mode,
      status: 'active',
      updatedAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [calendarConnections.userId, calendarConnections.provider, calendarConnections.externalAccountId],
      set: { syncMode: input.sync_mode, status: 'active', lastError: null, updatedAt: now },
    });

  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, userId),
        eq(calendarConnections.provider, input.provider),
        eq(calendarConnections.externalAccountId, externalAccountId),
      ),
    )
    .limit(1);
  return connection!;
}

export async function registerProviderCalendar(
  db: Db,
  userId: string,
  connectionId: string,
  input: ProviderCalendarInput,
) {
  const [connection] = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.userId, userId)))
    .limit(1);
  if (!connection) throw new Error('Calendar connection not found');

  const remoteId = requiredText(input.provider_calendar_id, 'provider_calendar_id');
  const now = Date.now();
  await db
    .insert(calendarProviderCalendars)
    .values({
      id: crypto.randomUUID(),
      connectionId,
      providerCalendarId: remoteId,
      name: requiredText(input.name, 'name'),
      timezone: input.timezone ?? null,
      selected: input.selected ?? false,
      studyusOwned: input.studyus_owned ?? false,
      accessRole: input.access_role ?? null,
      updatedAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [calendarProviderCalendars.connectionId, calendarProviderCalendars.providerCalendarId],
      set: {
        name: requiredText(input.name, 'name'),
        timezone: input.timezone ?? null,
        selected: input.selected ?? false,
        studyusOwned: input.studyus_owned ?? false,
        accessRole: input.access_role ?? null,
        updatedAt: now,
      },
    });

  const [calendar] = await db
    .select()
    .from(calendarProviderCalendars)
    .where(
      and(
        eq(calendarProviderCalendars.connectionId, connectionId),
        eq(calendarProviderCalendars.providerCalendarId, remoteId),
      ),
    )
    .limit(1);
  await db
    .insert(calendarSyncStates)
    .values({ id: crypto.randomUUID(), providerCalendarId: calendar!.id, updatedAt: now, createdAt: now })
    .onConflictDoNothing({ target: calendarSyncStates.providerCalendarId });
  return calendar!;
}

export async function applyProviderChange(
  db: Db,
  userId: string,
  providerCalendarId: string,
  change: ProviderEventChange,
) {
  const { calendar, connection } = await assertCalendarOwnership(db, userId, providerCalendarId);
  const providerEventId = requiredText(change.provider_event_id, 'provider_event_id');
  const now = Date.now();
  const [link] = await db
    .select()
    .from(calendarEventLinks)
    .where(
      and(
        eq(calendarEventLinks.userId, userId),
        eq(calendarEventLinks.providerCalendarId, providerCalendarId),
        eq(calendarEventLinks.providerEventId, providerEventId),
      ),
    )
    .limit(1);

  if (change.type === 'delete') {
    const statements: BatchItem<'sqlite'>[] = [
      db
        .insert(calendarExternalEvents)
        .values({
          id: crypto.randomUUID(),
          userId,
          providerCalendarId,
          providerEventId,
          providerVersion: change.provider_version ?? null,
          title: 'Busy',
          startKind: null,
          status: 'cancelled',
          updatedAt: now,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [calendarExternalEvents.providerCalendarId, calendarExternalEvents.providerEventId],
          set: { status: 'cancelled', providerVersion: change.provider_version ?? null, updatedAt: now },
        }),
    ];
    if (link) {
      statements.push(
        db
          .update(calendarEventLinks)
          .set({ providerVersion: change.provider_version ?? null, lastSyncedAt: now })
          .where(eq(calendarEventLinks.id, link.id)),
      );
      if (
        link.localEntityType === 'study_session' &&
        calendar.studyusOwned &&
        connection.syncMode === 'controlled'
      ) {
        statements.push(
          db
            .update(studySessions)
            .set({ scheduledAt: null })
            .where(and(eq(studySessions.id, link.localEntityId), eq(studySessions.userId, userId))),
        );
      }
    }
    await runBatch(db, statements);
  } else {
    const start = dateValue(change.start);
    const end = dateValue(change.end);
    if (change.start.kind !== change.end.kind) throw new Error('Event start and end kinds must match');
    if (change.start.kind === 'timed' && end.at! <= start.at!) throw new Error('Event end must be after start');
    if (change.start.kind === 'date' && end.date! <= start.date!) throw new Error('All-day end must be after start');

    const statements: BatchItem<'sqlite'>[] = [
      db
        .insert(calendarExternalEvents)
        .values({
          id: crypto.randomUUID(),
          userId,
          providerCalendarId,
          providerEventId,
          providerVersion: change.provider_version ?? null,
          iCalUid: change.ical_uid ?? null,
          recurringEventId: change.recurring_event_id ?? null,
          title: requiredText(change.title, 'title'),
          startKind: change.start.kind,
          startAt: start.at,
          startDate: start.date,
          endAt: end.at,
          endDate: end.date,
          timezone: start.timezone,
          busyStatus: change.busy_status,
          status: change.status ?? 'confirmed',
          recurrence: change.recurrence ?? null,
          updatedAt: now,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [calendarExternalEvents.providerCalendarId, calendarExternalEvents.providerEventId],
          set: {
            providerVersion: change.provider_version ?? null,
            iCalUid: change.ical_uid ?? null,
            recurringEventId: change.recurring_event_id ?? null,
            title: requiredText(change.title, 'title'),
            startKind: change.start.kind,
            startAt: start.at,
            startDate: start.date,
            endAt: end.at,
            endDate: end.date,
            timezone: start.timezone,
            busyStatus: change.busy_status,
            status: change.status ?? 'confirmed',
            recurrence: change.recurrence ?? null,
            updatedAt: now,
          },
        }),
    ];
    if (link) {
      statements.push(
        db
          .update(calendarEventLinks)
          .set({ providerVersion: change.provider_version ?? null, lastSyncedAt: now })
          .where(eq(calendarEventLinks.id, link.id)),
      );
      if (
        link.localEntityType === 'study_session' &&
        change.start.kind === 'timed' &&
        calendar.studyusOwned &&
        connection.syncMode === 'controlled'
      ) {
        statements.push(
          db
            .update(studySessions)
            .set({ scheduledAt: start.at, plannedMinutes: Math.round((end.at! - start.at!) / 60_000) })
            .where(and(eq(studySessions.id, link.localEntityId), eq(studySessions.userId, userId))),
        );
      }
    }
    await runBatch(db, statements);
  }

  const [event] = await db
    .select()
    .from(calendarExternalEvents)
    .where(
      and(
        eq(calendarExternalEvents.providerCalendarId, providerCalendarId),
        eq(calendarExternalEvents.providerEventId, providerEventId),
      ),
    )
    .limit(1);
  return event!;
}

export async function enqueueCalendarOperation(
  db: Db,
  userId: string,
  connectionId: string,
  input: { action: 'upsert' | 'delete'; entity_type: LocalEntityType; entity_id: string; revision: string },
) {
  const [connection] = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.userId, userId)))
    .limit(1);
  if (!connection) throw new Error('Calendar connection not found');

  const entityId = requiredText(input.entity_id, 'entity_id');
  const revision = requiredText(input.revision, 'revision');
  const dedupeKey = `${connectionId}:${input.entity_type}:${entityId}:${input.action}:${revision}`;
  const now = Date.now();
  await db
    .insert(calendarOutbox)
    .values({
      id: crypto.randomUUID(),
      userId,
      connectionId,
      action: input.action,
      entityType: input.entity_type,
      entityId,
      revision,
      dedupeKey,
      availableAt: now,
      updatedAt: now,
      createdAt: now,
    })
    .onConflictDoNothing({ target: calendarOutbox.dedupeKey });
  const [operation] = await db.select().from(calendarOutbox).where(eq(calendarOutbox.dedupeKey, dedupeKey)).limit(1);
  return operation!;
}
