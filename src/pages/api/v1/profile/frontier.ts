// GET /api/v1/profile/frontier — the ZPD learning frontier, computed on
// read from kcs + kc_edges (src/lib/services/zpd.ts::getGlobalFrontier),
// zero persistence. Response shape frozen in src/lib/schemas/zpd.ts.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { getGlobalFrontier } from '../../../../lib/services/zpd';

export const GET: APIRoute = async ({ locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const frontier = await getGlobalFrontier(db, locals.user!.id);
    return apiOk(toApi(frontier));
  });
