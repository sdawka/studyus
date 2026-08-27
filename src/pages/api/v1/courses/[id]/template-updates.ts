import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { applyTemplateUpdatesSchema } from '../../../../../lib/schemas/courseMap';
import { toApi } from '../../../../../lib/serialize';
import { applyTemplateUpdateActions } from '../../../../../lib/services/courseMap';

export const POST: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const input = applyTemplateUpdatesSchema.parse(await request.json().catch(() => ({})));
    const db = getDb(env.DB);
    return apiOk(toApi(await applyTemplateUpdateActions(db, locals.user!.id, params.id!, input)));
  });
