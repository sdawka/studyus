import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { getKcEvents } from '../../../../../lib/services/events';

export const GET: APIRoute = async ({ params, url, locals }) =>
  withServiceErrors(async () => {
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined;
    const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : undefined;
    const db = getDb(env.DB);
    const rows = await getKcEvents(db, locals.user!.id, params.id!, { limit, offset });
    return apiOk(toApi(rows));
  });
