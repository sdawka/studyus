import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { listPlanningRuns } from '../../../../../lib/services/planning';

export const GET: APIRoute = async ({ locals }) => withServiceErrors(async () =>
  apiOk(await listPlanningRuns(getDb(env.DB), locals.user!.id)));
