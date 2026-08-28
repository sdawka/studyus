import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { idSchema } from '../../../../lib/schemas/common';
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
    const rawIdempotencyKey = request.headers.get('Idempotency-Key');
    const idempotencyKey = rawIdempotencyKey === null ? undefined : idSchema.parse(rawIdempotencyKey).toLowerCase();
    const db = getDb(env.DB);
    const { event, masteryDeltas, wasCreated } = await createEvent(db, locals.user!.id, input, 'manual', idempotencyKey);
    return apiOk(
      { ...toApi(event), mastery_deltas: toApi(masteryDeltas) },
      wasCreated
        ? { status: 201 }
        : { status: 200, headers: { 'Idempotency-Replayed': 'true' } },
    );
  });
