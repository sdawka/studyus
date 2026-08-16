import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { listKcScaffoldsQuerySchema } from '../../../../../lib/schemas/knowledgeMap';
import { listKcScaffolds } from '../../../../../lib/services/knowledgeMap';

export const GET: APIRoute = async ({ params, url, locals }) =>
  withServiceErrors(async () => {
    const query = listKcScaffoldsQuerySchema.parse({
      kind: url.searchParams.get('kind') ?? undefined,
      max_level: url.searchParams.get('max_level') ?? undefined,
    });
    const db = getDb(env.DB);
    const rows = await listKcScaffolds(db, locals.user!.id, params.id!, { kind: query.kind, maxLevel: query.max_level });
    return apiOk(toApi(rows));
  });
