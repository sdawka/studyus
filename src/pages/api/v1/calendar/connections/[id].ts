import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { disconnectCalendarProvider } from '../../../../../lib/services/calendarConnect';

export const DELETE: APIRoute = async ({ locals, params }) =>
  withServiceErrors(async () => {
    await disconnectCalendarProvider(getDb(env.DB), locals.user!.id, params.id!);
    return apiOk({ disconnected: true });
  });
