import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { planningPreferencesSchema } from '../../../../lib/schemas/planning';
import { getPlanningPreferences, updatePlanningPreferences } from '../../../../lib/services/planning';

export const GET: APIRoute = async ({ locals }) => withServiceErrors(async () =>
  apiOk(await getPlanningPreferences(getDb(env.DB), locals.user!.id)));

export const PUT: APIRoute = async ({ request, locals }) => withServiceErrors(async () => {
  const input = planningPreferencesSchema.parse(await request.json().catch(() => ({})));
  return apiOk(await updatePlanningPreferences(getDb(env.DB), locals.user!.id, input));
});
