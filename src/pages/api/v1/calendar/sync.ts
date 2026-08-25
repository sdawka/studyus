import { clerkClient } from '@clerk/astro/server';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import {
  createClerkCalendarTokenBroker,
  createGoogleCalendarProvider,
  createMicrosoftCalendarProvider,
} from '../../../../lib/calendar/providers';
import { syncStaleUserCalendars } from '../../../../lib/services/calendarActivitySync';

export const POST: APIRoute = async (context) => {
  const providers = {
    google: createGoogleCalendarProvider({ fetch: globalThis.fetch }),
    microsoft: createMicrosoftCalendarProvider({ fetch: globalThis.fetch }),
  };
  return apiOk(await syncStaleUserCalendars(getDb(env.DB), context.locals.user!.id, {
    providers,
    tokenBroker: createClerkCalendarTokenBroker(clerkClient(context)),
  }));
};
