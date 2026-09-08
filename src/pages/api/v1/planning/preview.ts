import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { previewPlan } from '../../../../lib/services/planning';

export const POST: APIRoute = async ({ locals }) => withServiceErrors(async () =>
  apiOk(await previewPlan(getDb(env.DB), locals.user!.id)));
