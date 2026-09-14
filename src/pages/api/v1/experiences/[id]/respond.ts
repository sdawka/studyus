import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { experienceResponseSchema } from '../../../../../lib/schemas/experienceResponse';
import { idSchema } from '../../../../../lib/schemas/common';
import { respondToExperience } from '../../../../../lib/services/events';

export const POST: APIRoute = async ({ request, locals, params }) => withServiceErrors(async () => {
  const input = experienceResponseSchema.parse(await request.json().catch(() => ({})));
  const rawIdempotencyKey = request.headers.get('Idempotency-Key');
  const idempotencyKey = rawIdempotencyKey === null ? undefined : idSchema.parse(rawIdempotencyKey).toLowerCase();
  const result = await respondToExperience(getDb(env.DB), locals.user!.id, params.id!, input, idempotencyKey);
  return apiOk({ event: result.event, mastery_deltas: result.masteryDeltas }, {
    status: result.wasCreated ? 201 : 200,
    ...(result.wasCreated ? {} : { headers: { 'Idempotency-Replayed': 'true' } }),
  });
});
