import { clerkClient } from '@clerk/astro/server';
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getDb } from '../../../../../db/client';
import { apiError, apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { calendarConnectAttemptEvents } from '../../../../../lib/analytics/retention';
import { analyticsRequestCorrelation, queueBehavioralEvents } from '../../../../../lib/analytics/server';
import { createClerkCalendarTokenBroker, ProviderTokenUnavailableError } from '../../../../../lib/calendar/providers';
import { connectCalendarProvider, listCalendarConnections } from '../../../../../lib/services/calendarConnect';
import { resolveSettings } from '../../../../../lib/services/user';

const connectSchema = z.strictObject({ provider: z.enum(['google', 'microsoft']) });

export const GET: APIRoute = async ({ locals }) =>
  withServiceErrors(async () => apiOk(await listCalendarConnections(getDb(env.DB), locals.user!.id)));

export const POST: APIRoute = (context) =>
  withServiceErrors(async () => {
    const localUser = context.locals.user!;
    if (!localUser.clerkUserId) return apiError('calendar_identity_missing', 'Reconnect your Studyus account first.', 409);
    const input = connectSchema.parse(await context.request.json().catch(() => ({})));

    const startedAt = Date.now();
    const queueOutcome = (outcome: 'connected' | 'failed') => {
      try {
        const correlation = analyticsRequestCorrelation(context.request);
        if (!correlation.session_id) return;
        const events = calendarConnectAttemptEvents({
          user_id: localUser.id,
          session_id: correlation.session_id,
          surface: '/settings',
        }, {
          provider: input.provider,
          started_at: startedAt,
          completed_at: Date.now(),
          outcome,
        });
        queueBehavioralEvents({
          env,
          request: context.request,
          execution: context.locals.cfContext,
          user_id: localUser.id,
          analytics_opt_out: resolveSettings(localUser.settings).analytics_opt_out,
        }, events, { force_batch: true });
      } catch {
        console.warn(JSON.stringify({ message: 'calendar connection analytics queue failed' }));
      }
    };

    try {
      const broker = createClerkCalendarTokenBroker(clerkClient(context));
      const result = await connectCalendarProvider(getDb(env.DB), localUser.id, localUser.clerkUserId, input.provider, {
        fetch: globalThis.fetch,
        tokenBroker: broker,
        timezone: localUser.timezone,
      });
      queueOutcome('connected');
      return apiOk(result, { status: 201 });
    } catch (error) {
      queueOutcome('failed');
      if (error instanceof ProviderTokenUnavailableError) {
        return apiError(
          'calendar_permission_required',
          `Grant ${input.provider === 'google' ? 'Google Calendar' : 'Microsoft Calendar'} access from Account, then try again.`,
          409,
        );
      }
      console.error(JSON.stringify({ message: 'calendar connection failed', provider: input.provider, error: error instanceof Error ? error.message : String(error) }));
      return apiError('calendar_connection_failed', 'Could not connect that calendar provider.', 502);
    }
  });
