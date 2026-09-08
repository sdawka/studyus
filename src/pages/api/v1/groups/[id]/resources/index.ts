import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { createGroupResourceSchema } from '../../../../../../lib/schemas/groups';
import { createGroupResource, listGroupResources, publicGroupResource } from '../../../../../../lib/services/groups';
import { toApi } from '../../../../../../lib/serialize';

export const GET: APIRoute = async ({ params, locals }) => withServiceErrors(async () => {
  const resources = await listGroupResources(getDb(env.DB), locals.user!.id, params.id!);
  return apiOk(toApi({ resources: resources.map(publicGroupResource) }));
});

export const POST: APIRoute = async ({ params, request, locals }) => withServiceErrors(async () => {
  const input = createGroupResourceSchema.parse(await request.json().catch(() => ({})));
  const resource = await createGroupResource(getDb(env.DB), locals.user!.id, params.id!, input);
  return apiOk(toApi(publicGroupResource(resource)), { status: 201 });
});
