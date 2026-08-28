import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { discardStudySessionSchema } from '../../../../../lib/schemas/sessions';
import { discardSession } from '../../../../../lib/services/sessions';

export const PATCH: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = discardStudySessionSchema.parse(body);
    const db = getDb(env.DB);
    const result = await discardSession(db, locals.user!.id, params.id!, input);
    return apiOk(toApi(result));
  });
