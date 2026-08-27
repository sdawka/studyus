import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { nextMoveQuerySchema } from '../../../../lib/schemas/nextMove';
import { toApi } from '../../../../lib/serialize';
import { getNextMove } from '../../../../lib/services/nextMove';

export const GET: APIRoute = async ({ locals, url }) =>
  withServiceErrors(async () => {
    const query = nextMoveQuerySchema.parse({ available_minutes: url.searchParams.get('available_minutes') ?? undefined });
    return apiOk(toApi(await getNextMove(getDb(env.DB), locals.user!.id, query.available_minutes)));
  });
