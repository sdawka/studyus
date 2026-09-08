import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { listGroupMembers } from '../../../../../../lib/services/groups';
import { toApi } from '../../../../../../lib/serialize';

export const GET: APIRoute = async ({ params, locals }) => withServiceErrors(async () => {
  const members = await listGroupMembers(getDb(env.DB), locals.user!.id, params.id!);
  return apiOk(toApi({ members }));
});
