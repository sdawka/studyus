import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { updateClassSessionSchema } from '../../../../lib/schemas/classSessions';
import { updateClassSessionStatus } from '../../../../lib/services/classSessions';

export const PATCH: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = updateClassSessionSchema.parse(body);
    const db = getDb(env.DB);
    const updated = await updateClassSessionStatus(db, locals.user!.id, params.id!, input);
    return apiOk(toApi(updated));
  });
