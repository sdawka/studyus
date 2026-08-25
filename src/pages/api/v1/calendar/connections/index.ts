import { clerkClient } from '@clerk/astro/server';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getDb } from '../../../../../db/client';
import { apiError, apiOk } from '../../../../../lib/api';
import { createClerkCalendarTokenBroker, ProviderTokenUnavailableError } from '../../../../../lib/calendar/providers';
import { connectCalendarProvider, listCalendarConnections } from '../../../../../lib/services/calendarConnect';

const connectSchema = z.strictObject({ provider: z.enum(['google', 'microsoft']) });

export const GET: APIRoute = async ({ locals }) =>
  apiOk(await listCalendarConnections(getDb(env.DB), locals.user!.id));

export const POST: APIRoute = async (context) => {
  const localUser = context.locals.user!;
  if (!localUser.clerkUserId) return apiError('calendar_identity_missing', 'Reconnect your Studyus account first.', 409);
  const parsed = connectSchema.safeParse(await context.request.json().catch(() => ({})));
  if (!parsed.success) return apiError('invalid_input', parsed.error.issues.map((issue) => issue.message).join('; '), 400);

  try {
    const broker = createClerkCalendarTokenBroker(clerkClient(context));
    const result = await connectCalendarProvider(getDb(env.DB), localUser.id, localUser.clerkUserId, parsed.data.provider, {
      fetch: globalThis.fetch,
      tokenBroker: broker,
      timezone: localUser.timezone,
    });
    return apiOk(result, { status: 201 });
  } catch (error) {
    if (error instanceof ProviderTokenUnavailableError) {
      return apiError(
        'calendar_permission_required',
        `Grant ${parsed.data.provider === 'google' ? 'Google Calendar' : 'Microsoft Calendar'} access from Account, then try again.`,
        409,
      );
    }
    console.error(JSON.stringify({ message: 'calendar connection failed', provider: parsed.data.provider, error: error instanceof Error ? error.message : String(error) }));
    return apiError('calendar_connection_failed', 'Could not connect that calendar provider.', 502);
  }
};
