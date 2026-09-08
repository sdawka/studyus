import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { planningApplySchema } from '../../../../../../lib/schemas/planning';
import { applyPlan } from '../../../../../../lib/services/planning';

export const POST: APIRoute = async ({ request, locals, params }) => withServiceErrors(async () => {
  const input = planningApplySchema.parse(await request.json().catch(() => ({})));
  return apiOk(await applyPlan(getDb(env.DB), locals.user!.id, params.id!, input.sourceRevision));
});
