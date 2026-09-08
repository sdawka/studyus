import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../db/client';
import { apiError, apiOk } from '../../../lib/api';
import { withServiceErrors } from '../../../lib/apiErrors';
import { requestPrefersNoTracking } from '../../../lib/analytics/config';
import { queueBehavioralEvents } from '../../../lib/analytics/server';
import { demoFunnelBatchSchema } from '../../../lib/schemas/onboarding';
import { demoRowsToBehavioralEvents, insertDemoFunnelBatch } from '../../../lib/services/demoFunnel';

const RATE_LIMIT_RETRY_SECONDS = 60;

export const POST: APIRoute = async ({ request, locals, clientAddress }) =>
  withServiceErrors(async () => {
    if (requestPrefersNoTracking(request)) return apiOk({ accepted: 0 });

    // Astro supplies clientAddress from the trusted runtime request context.
    // The address is used only as the ephemeral limiter key and is never
    // persisted or logged. Direct/local callers without one share a bounded
    // fallback bucket instead of receiving an unmetered path.
    const limiterKey = `studyus:demo:${clientAddress?.trim() || 'local-unknown'}`;
    const { success } = await env.DEMO_INGEST_LIMITER.limit({ key: limiterKey });
    if (!success) {
      const response = apiError('rate_limited', 'Too many demo analytics requests', 429);
      response.headers.set('Retry-After', String(RATE_LIMIT_RETRY_SECONDS));
      return response;
    }

    const body = demoFunnelBatchSchema.parse(await request.json().catch(() => ({})));
    const result = await insertDemoFunnelBatch(getDb(env.DB), body);
    const events = demoRowsToBehavioralEvents(result.inserted, body.app_session_id);
    if (body.anonymous_id && events.length > 0) {
      queueBehavioralEvents({
        env,
        request,
        execution: locals.cfContext,
        analytics_opt_out: false,
        anonymous_id: body.anonymous_id,
      }, events, { force_batch: true });
    }
    return apiOk({ accepted: result.accepted });
  });
