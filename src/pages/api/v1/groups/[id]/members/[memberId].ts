import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { removeGroupMember } from '../../../../../../lib/services/groups';

export const DELETE: APIRoute = async ({ params, locals }) => withServiceErrors(async () => {
  await removeGroupMember(getDb(env.DB), locals.user!.id, params.id!, params.memberId!);
  return apiOk({});
});
