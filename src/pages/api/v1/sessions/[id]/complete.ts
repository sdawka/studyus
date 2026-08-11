import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { completeStudySessionSchema } from '../../../../../lib/schemas/sessions';
import { completeSession } from '../../../../../lib/services/sessions';

export const PATCH: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = completeStudySessionSchema.parse(body);
    const db = getDb(env.DB);
    const result = await completeSession(db, locals.user!.id, params.id!, input);
    return apiOk(toApi(result));
  });
