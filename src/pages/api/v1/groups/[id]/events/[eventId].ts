import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { updateGroupEventApiSchema } from '../../../../../../lib/schemas/groups';
import { cancelGroupEvent, publicGroupEvent, updateGroupEvent } from '../../../../../../lib/services/groups';
import { toApi } from '../../../../../../lib/serialize';

export const PATCH: APIRoute = async ({ params, request, locals }) => withServiceErrors(async () => {
  const input = updateGroupEventApiSchema.parse(await request.json().catch(() => ({})));
  const event = await updateGroupEvent(getDb(env.DB), locals.user!.id, params.id!, params.eventId!, input);
  return apiOk(toApi(publicGroupEvent(event)));
});

export const DELETE: APIRoute = async ({ params, locals }) => withServiceErrors(async () => {
  await cancelGroupEvent(getDb(env.DB), locals.user!.id, params.id!, params.eventId!);
  return apiOk({});
});
