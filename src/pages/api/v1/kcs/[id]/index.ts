import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { updateKcSchema } from '../../../../../lib/schemas/kcs';
import { getKc, updateKc } from '../../../../../lib/services/kcs';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const kc = await getKc(db, locals.user!.id, params.id!);
    return apiOk(toApi(kc));
  });

export const PATCH: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = updateKcSchema.parse(body);
    const db = getDb(env.DB);
    const kc = await updateKc(db, locals.user!.id, params.id!, input);
    return apiOk(toApi(kc));
  });
