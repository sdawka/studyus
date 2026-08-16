import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { getKcGraph } from '../../../../../lib/services/knowledgeMap';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const graph = await getKcGraph(db, locals.user!.id, params.id!);
    return apiOk(toApi(graph));
  });
