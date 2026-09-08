import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { updateGroupResourceSchema } from '../../../../../../lib/schemas/groups';
import { deleteGroupResource, publicGroupResource, updateGroupResource } from '../../../../../../lib/services/groups';
import { toApi } from '../../../../../../lib/serialize';

export const PATCH: APIRoute = async ({ params, request, locals }) => withServiceErrors(async () => {
  const input = updateGroupResourceSchema.parse(await request.json().catch(() => ({})));
  const resource = await updateGroupResource(getDb(env.DB), locals.user!.id, params.id!, params.resourceId!, input);
  return apiOk(toApi(publicGroupResource(resource)));
});

export const DELETE: APIRoute = async ({ params, locals }) => withServiceErrors(async () => {
  await deleteGroupResource(getDb(env.DB), locals.user!.id, params.id!, params.resourceId!);
  return apiOk({});
});
