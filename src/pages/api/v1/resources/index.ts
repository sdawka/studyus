import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { createResourceSchema, listResourcesQuerySchema } from '../../../../lib/schemas/resources';
import { createResource, listResources } from '../../../../lib/services/resources';

export const GET: APIRoute = async ({ url, locals }) =>
  withServiceErrors(async () => {
    const query = listResourcesQuerySchema.parse(Object.fromEntries(url.searchParams));
    const db = getDb(env.DB);
    const rows = await listResources(db, locals.user!.id, query);
    return apiOk(toApi(rows));
  });

export const POST: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = createResourceSchema.parse(body);
    const db = getDb(env.DB);
    const created = await createResource(db, locals.user!.id, input);
    return apiOk(toApi(created), { status: 201 });
  });
