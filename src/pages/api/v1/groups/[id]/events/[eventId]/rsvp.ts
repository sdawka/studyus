import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../../db/client';
import { apiOk } from '../../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../../lib/apiErrors';
import { groupRsvpSchema } from '../../../../../../../lib/schemas/groups';
import { setGroupEventRsvp } from '../../../../../../../lib/services/groups';
import { toApi } from '../../../../../../../lib/serialize';

export const PUT: APIRoute = async ({ params, request, locals }) => withServiceErrors(async () => {
  const { response } = groupRsvpSchema.parse(await request.json().catch(() => ({})));
  const rsvp = await setGroupEventRsvp(getDb(env.DB), locals.user!.id, params.id!, params.eventId!, response);
  return apiOk(toApi({ eventId: rsvp.eventId, response: rsvp.response }));
});
