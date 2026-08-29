import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { calendarConnections, calendarProviderCalendars, calendarSyncStates } from '../../db/schema';
import { CALENDAR_ACTIVITY_STALE_MS } from '../calendar/domain';
import type { CalendarTokenBroker } from '../calendar/providers';
import { syncProviderCalendar, type CalendarProviderRegistry } from './calendarSyncEngine';

interface ActivitySyncDependencies {
  providers: CalendarProviderRegistry;
  tokenBroker: CalendarTokenBroker;
  now?: number;
  staleAfterMs?: number;
  syncCalendar?: typeof syncProviderCalendar;
}

export async function syncStaleUserCalendars(db: Db, userId: string, dependencies: ActivitySyncDependencies) {
  const now = dependencies.now ?? Date.now();
  const staleBefore = now - (dependencies.staleAfterMs ?? CALENDAR_ACTIVITY_STALE_MS);
  const calendars = await db
    .select({ id: calendarProviderCalendars.id })
    .from(calendarProviderCalendars)
    .innerJoin(calendarConnections, eq(calendarProviderCalendars.connectionId, calendarConnections.id))
    .innerJoin(calendarSyncStates, eq(calendarSyncStates.providerCalendarId, calendarProviderCalendars.id))
    .where(and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.status, 'active'),
      eq(calendarProviderCalendars.selected, true),
      or(isNull(calendarSyncStates.lastSyncedAt), lt(calendarSyncStates.lastSyncedAt, staleBefore)),
    ));

  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - 3);
  const to = new Date(now);
  to.setUTCFullYear(to.getUTCFullYear() + 1);
  const syncCalendar = dependencies.syncCalendar ?? syncProviderCalendar;
  const results = await Promise.allSettled(calendars.map((calendar) => syncCalendar(
    db,
    calendar.id,
    dependencies.providers,
    dependencies.tokenBroker,
    { from: from.toISOString(), to: to.toISOString() },
  )));
  const successes = results.filter((result): result is PromiseFulfilledResult<{ applied: number; cursor: string }> => result.status === 'fulfilled');
  return {
    attempted: calendars.length,
    synced: successes.length,
    failed: results.length - successes.length,
    applied: successes.reduce((sum, result) => sum + result.value.applied, 0),
  };
}
