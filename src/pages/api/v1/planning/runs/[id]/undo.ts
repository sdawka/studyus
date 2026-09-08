import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { undoPlan } from '../../../../../../lib/services/planning';

export const POST: APIRoute = async ({ locals, params }) => withServiceErrors(async () =>
  apiOk(await undoPlan(getDb(env.DB), locals.user!.id, params.id!)));
