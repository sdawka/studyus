import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  calendarConnections,
  calendarExternalEvents,
  calendarProviderCalendars,
  calendarSyncStates,
  users,
} from '../../db/schema';
import type {
  CalendarProviderAdapter,
  CalendarProviderName,
  CalendarTokenBroker,
  ProviderChange,
  ProviderSyncResult,
} from '../calendar/providers';
import { CalendarProviderHttpError, ProviderTokenUnavailableError } from '../calendar/providers';
import { applyProviderChange } from './calendarSync';

export type CalendarProviderRegistry = Partial<Record<CalendarProviderName, CalendarProviderAdapter>>;

const READ_SCOPES: Record<CalendarProviderName, readonly string[]> = {
  google: ['https://www.googleapis.com/auth/calendar.events.readonly'],
  // Controlled setup requests ReadWrite; Clerk reports that granted scope
  // literally rather than expanding it into a separate Calendars.Read entry.
  microsoft: ['Calendars.ReadWrite'],
};

function providerVersion(change: ProviderChange): string | null {
  return change.operation === 'upsert'
    ? change.event.etag ?? change.event.changeKey ?? null
    : change.etag ?? change.changeKey ?? null;
}

function providerChangeInput(change: ProviderChange, retainTitle: boolean) {
  if (change.operation === 'delete') {
    return {
      type: 'delete' as const,
      provider_event_id: change.remoteId,
      provider_version: providerVersion(change),
    };
  }
  const event = change.event;
  if (event.allDay) {
    return {
      type: 'upsert' as const,
      provider_event_id: event.remoteId,
      provider_version: providerVersion(change),
      title: retainTitle ? event.title || 'Busy' : 'Busy',
      start: { kind: 'date' as const, date: event.start },
      end: { kind: 'date' as const, date: event.end },
      busy_status: event.busyStatus ?? 'busy' as const,
    };
  }
  return {
    type: 'upsert' as const,
    provider_event_id: event.remoteId,
    provider_version: providerVersion(change),
    title: retainTitle ? event.title || 'Busy' : 'Busy',
    start: { kind: 'timed' as const, at: event.start, timezone: event.timezone ?? 'UTC' },
    end: { kind: 'timed' as const, at: event.end, timezone: event.timezone ?? 'UTC' },
    busy_status: event.busyStatus ?? 'busy' as const,
  };
}

export async function syncProviderCalendar(
  db: Db,
  providerCalendarId: string,
  providers: CalendarProviderRegistry,
  tokenBroker: CalendarTokenBroker,
  window: { from: string; to: string },
) {
  const [record] = await db
    .select({
      calendar: calendarProviderCalendars,
      connection: calendarConnections,
      state: calendarSyncStates,
      clerkUserId: users.clerkUserId,
    })
    .from(calendarProviderCalendars)
    .innerJoin(calendarConnections, eq(calendarProviderCalendars.connectionId, calendarConnections.id))
    .innerJoin(users, eq(calendarConnections.userId, users.id))
    .innerJoin(calendarSyncStates, eq(calendarSyncStates.providerCalendarId, calendarProviderCalendars.id))
    .where(and(eq(calendarProviderCalendars.id, providerCalendarId), eq(calendarProviderCalendars.selected, true)))
    .limit(1);
  if (!record) throw new Error('Selected provider calendar not found');
  if (!record.clerkUserId) throw new Error('Calendar owner has no Clerk identity');

  const provider = providers[record.connection.provider];
  if (!provider) throw new Error(`Calendar provider ${record.connection.provider} is not configured`);

  let accessToken: string;
  try {
    accessToken = await tokenBroker.getAccessToken(
      record.clerkUserId,
      record.connection.provider,
      READ_SCOPES[record.connection.provider],
    );
  } catch (error) {
    if (error instanceof ProviderTokenUnavailableError) {
      await db
        .update(calendarConnections)
        .set({ status: 'reconnect_required', lastError: error.message, updatedAt: Date.now() })
        .where(eq(calendarConnections.id, record.connection.id));
    }
    throw error;
  }

  const syncRequest = {
    accessToken,
    calendarId: record.calendar.providerCalendarId,
    cursor: record.state.cursor ?? undefined,
    from: window.from,
    to: window.to,
  };
  let fullSnapshot = false;
  let result: ProviderSyncResult;
  try {
    try {
      result = await provider.sync(syncRequest);
    } catch (error) {
      // Google expires incremental sync tokens with HTTP 410. Fetch the complete
      // replacement before touching materialized events, so a failed recovery
      // leaves both the usable cache and old cursor intact for another attempt.
      if (
        record.connection.provider !== 'google'
        || !syncRequest.cursor
        || !(error instanceof CalendarProviderHttpError)
        || error.status !== 410
      ) {
        throw error;
      }
      result = await provider.sync({ ...syncRequest, cursor: undefined });
      fullSnapshot = true;
    }
  } catch (error) {
    const now = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(calendarSyncStates)
      .set({ lastError: message, updatedAt: now })
      .where(eq(calendarSyncStates.id, record.state.id));
    await db
      .update(calendarConnections)
      .set({ lastError: message, updatedAt: now })
      .where(eq(calendarConnections.id, record.connection.id));
    throw error;
  }

  let staleProviderEventIds: string[] = [];
  if (fullSnapshot) {
    const snapshotIds = new Set(
      result.changes
        .filter((change) => change.operation === 'upsert')
        .map((change) => change.event.remoteId),
    );
    const explicitlyChangedIds = new Set(result.changes.map((change) =>
      change.operation === 'upsert' ? change.event.remoteId : change.remoteId));
    const fromMs = Date.parse(window.from);
    const toMs = Date.parse(window.to);
    const cached = await db
      .select()
      .from(calendarExternalEvents)
      .where(eq(calendarExternalEvents.providerCalendarId, record.calendar.id));
    staleProviderEventIds = cached
      .filter((event) => {
        if (
          event.status === 'cancelled'
          || snapshotIds.has(event.providerEventId)
          || explicitlyChangedIds.has(event.providerEventId)
        ) return false;
        if (event.startKind === 'timed' && event.startAt !== null) {
          return event.startAt <= toMs && (event.endAt ?? event.startAt) >= fromMs;
        }
        if (event.startKind === 'date' && event.startDate) {
          const start = Date.parse(`${event.startDate}T12:00:00.000Z`);
          const end = Date.parse(`${event.endDate ?? event.startDate}T12:00:00.000Z`);
          return start <= toMs && end >= fromMs;
        }
        return false;
      })
      .map((event) => event.providerEventId);
  }

  // Advance the cursor only after every change commits. A partial failure
  // leaves the old cursor in place, and the idempotent event upserts make the
  // replay safe.
  for (const change of result.changes) {
    await applyProviderChange(
      db,
      record.connection.userId,
      record.calendar.id,
      // Provider-owned calendars are imported for availability only. Keeping
      // their titles would persist sensitive appointments Studyus never uses.
      providerChangeInput(change, record.calendar.studyusOwned),
    );
  }
  // Only after every returned event has materialized do we tombstone cached
  // events absent from the successful full snapshot. Each operation remains
  // idempotent, so any failure before cursor advancement can be replayed.
  for (const providerEventId of staleProviderEventIds) {
    await applyProviderChange(db, record.connection.userId, record.calendar.id, {
      type: 'delete',
      provider_event_id: providerEventId,
      provider_version: null,
    });
  }
  const now = Date.now();
  await db
    .update(calendarSyncStates)
    .set({ cursor: result.cursor, lastSyncedAt: now, lastError: null, updatedAt: now })
    .where(eq(calendarSyncStates.id, record.state.id));
  await db
    .update(calendarConnections)
    .set({ status: 'active', lastError: null, updatedAt: now })
    .where(eq(calendarConnections.id, record.connection.id));
  return { applied: result.changes.length + staleProviderEventIds.length, cursor: result.cursor };
}
