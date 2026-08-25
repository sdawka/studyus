import { clerkClient } from '@clerk/astro/server';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../../../../db/client';
import { calendarConnections, calendarProviderCalendars } from '../../../../../../db/schema';
import { apiError, apiOk } from '../../../../../../lib/api';
import {
  createClerkCalendarTokenBroker,
  createGoogleCalendarProvider,
  createMicrosoftCalendarProvider,
} from '../../../../../../lib/calendar/providers';
import { syncProviderCalendar } from '../../../../../../lib/services/calendarSyncEngine';
import { processCalendarOutbox } from '../../../../../../lib/services/calendarOutboxProcessor';

export const POST: APIRoute = async (context) => {
  const db = getDb(env.DB);
  const user = context.locals.user!;
  const calendars = await db
    .select({ id: calendarProviderCalendars.id })
    .from(calendarProviderCalendars)
    .innerJoin(calendarConnections, eq(calendarProviderCalendars.connectionId, calendarConnections.id))
    .where(
      and(
        eq(calendarConnections.id, context.params.id!),
        eq(calendarConnections.userId, user.id),
        eq(calendarProviderCalendars.selected, true),
      ),
    );
  if (!calendars.length) return apiError('not_found', 'Calendar connection not found.', 404);

  const now = new Date();
  const from = new Date(now);
  from.setUTCMonth(from.getUTCMonth() - 3);
  const to = new Date(now);
  to.setUTCFullYear(to.getUTCFullYear() + 1);
  const providers = {
    google: createGoogleCalendarProvider({ fetch: globalThis.fetch }),
    microsoft: createMicrosoftCalendarProvider({ fetch: globalThis.fetch }),
  };
  const broker = createClerkCalendarTokenBroker(clerkClient(context));
  const results = [];
  for (const calendar of calendars) {
    results.push(await syncProviderCalendar(db, calendar.id, providers, broker, { from: from.toISOString(), to: to.toISOString() }));
  }
  const outbound = await processCalendarOutbox(
    db,
    { providers, tokenBroker: broker },
    { connectionId: context.params.id!, limit: 100 },
  );
  return apiOk({
    calendars: results.length,
    applied: results.reduce((sum, result) => sum + result.applied, 0),
    outbound,
  });
};
