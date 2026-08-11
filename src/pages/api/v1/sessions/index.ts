import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { createStudySessionSchema, listSessionsQuerySchema } from '../../../../lib/schemas/sessions';
import { createSession, listSessions } from '../../../../lib/services/sessions';

export const GET: APIRoute = async ({ url, locals }) =>
  withServiceErrors(async () => {
    const query = listSessionsQuerySchema.parse(Object.fromEntries(url.searchParams));
    const db = getDb(env.DB);
    const rows = await listSessions(db, locals.user!.id, query);
    return apiOk(toApi(rows));
  });

export const POST: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = createStudySessionSchema.parse(body);
    const db = getDb(env.DB);
    const created = await createSession(db, locals.user!.id, input);
    return apiOk(toApi(created), { status: 201 });
  });
