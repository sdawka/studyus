import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../db/client';
import { apiOk } from '../../../lib/api';
import { withServiceErrors } from '../../../lib/apiErrors';
import { requestPrefersNoTracking } from '../../../lib/analytics/config';
import { queueBehavioralEvents } from '../../../lib/analytics/server';
import { demoFunnelBatchSchema } from '../../../lib/schemas/onboarding';
import { demoRowsToBehavioralEvents, insertDemoFunnelBatch } from '../../../lib/services/demoFunnel';

export const POST: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = demoFunnelBatchSchema.parse(await request.json().catch(() => ({})));
    if (requestPrefersNoTracking(request)) return apiOk({ accepted: 0 });
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
