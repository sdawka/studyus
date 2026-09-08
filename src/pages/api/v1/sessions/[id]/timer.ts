import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { sessionTimerCommandSchema } from '../../../../../lib/schemas/sessions';
import { getSessionTiming, heartbeatSessionTiming, pauseSessionTiming, resumeSessionTiming, takeOverSessionTiming } from '../../../../../lib/services/sessionTiming';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    return apiOk(toApi(await getSessionTiming(db, locals.user!.id, params.id!)));
  });

export const POST: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const command = sessionTimerCommandSchema.parse(body);
    const db = getDb(env.DB);
    const userId = locals.user!.id;
    const sessionId = params.id!;
    switch (command.operation) {
      case 'resume':
        return apiOk(toApi(await resumeSessionTiming(db, userId, sessionId, { deviceId: command.device_id, leaseToken: command.lease_token })));
      case 'heartbeat':
        return apiOk(toApi(await heartbeatSessionTiming(db, userId, sessionId, {
          deviceId: command.device_id, leaseToken: command.lease_token, sequence: command.sequence, revision: command.revision,
        })));
      case 'pause':
        return apiOk(toApi(await pauseSessionTiming(db, userId, sessionId, {
          deviceId: command.device_id, leaseToken: command.lease_token, sequence: command.sequence, revision: command.revision,
        })));
      case 'takeover':
        return apiOk(toApi(await takeOverSessionTiming(db, userId, sessionId, { deviceId: command.device_id })));
    }
  });
