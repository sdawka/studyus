import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { getGroup, publicGroupSummary } from '../../../../../lib/services/groups';
import { toApi } from '../../../../../lib/serialize';

export const GET: APIRoute = async ({ params, locals }) => withServiceErrors(async () => {
  const group = await getGroup(getDb(env.DB), locals.user!.id, params.id!);
  return apiOk(toApi(publicGroupSummary(group)));
});
