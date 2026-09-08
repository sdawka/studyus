import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { createGroupEventApiSchema } from '../../../../../../lib/schemas/groups';
import { createGroupEvent, listGroupEvents, publicGroupEvent } from '../../../../../../lib/services/groups';
import { toApi } from '../../../../../../lib/serialize';

export const GET: APIRoute = async ({ params, locals }) => withServiceErrors(async () => {
  const events = await listGroupEvents(getDb(env.DB), locals.user!.id, params.id!);
  return apiOk(toApi({ events: events.map(publicGroupEvent) }));
});

export const POST: APIRoute = async ({ params, request, locals }) => withServiceErrors(async () => {
  const input = createGroupEventApiSchema.parse(await request.json().catch(() => ({})));
  const event = await createGroupEvent(getDb(env.DB), locals.user!.id, params.id!, input);
  return apiOk(toApi(publicGroupEvent(event)), { status: 201 });
});
