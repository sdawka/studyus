import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { updateEventSchema } from '../../../../lib/schemas/events';
import { deleteEvent, updateEvent } from '../../../../lib/services/events';

export const PATCH: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = updateEventSchema.parse(body);
    const db = getDb(env.DB);
    const { event, masteryDeltas } = await updateEvent(db, locals.user!.id, params.id!, input);
    return apiOk({ ...toApi(event), mastery_deltas: toApi(masteryDeltas) });
  });

export const DELETE: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const { masteryDeltas } = await deleteEvent(db, locals.user!.id, params.id!);
    return apiOk({ mastery_deltas: toApi(masteryDeltas) });
  });
