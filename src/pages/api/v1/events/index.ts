import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { createEventSchema, listEventsQuerySchema } from '../../../../lib/schemas/events';
import { createEvent, listEvents } from '../../../../lib/services/events';

export const GET: APIRoute = async ({ url, locals }) =>
  withServiceErrors(async () => {
    const query = listEventsQuerySchema.parse(Object.fromEntries(url.searchParams));
    const db = getDb(env.DB);
    const rows = await listEvents(db, locals.user!.id, query);
    return apiOk(toApi(rows));
  });

export const POST: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = createEventSchema.parse(body);
    const db = getDb(env.DB);
    const { event, masteryDeltas } = await createEvent(db, locals.user!.id, input);
    return apiOk({ ...toApi(event), mastery_deltas: toApi(masteryDeltas) }, { status: 201 });
  });
