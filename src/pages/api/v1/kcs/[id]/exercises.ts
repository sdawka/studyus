import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { listKcExercisesQuerySchema } from '../../../../../lib/schemas/exercises';
import { listKcExercises } from '../../../../../lib/services/exercises';

export const GET: APIRoute = async ({ params, url, locals }) =>
  withServiceErrors(async () => {
    const query = listKcExercisesQuerySchema.parse({
      kind: url.searchParams.get('kind') ?? undefined,
    });
    const db = getDb(env.DB);
    const rows = await listKcExercises(db, locals.user!.id, params.id!, { kind: query.kind });
    return apiOk(toApi(rows));
  });
