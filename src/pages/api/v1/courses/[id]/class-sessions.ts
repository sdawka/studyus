import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { createClassSessionSchema, listClassSessionsQuerySchema } from '../../../../../lib/schemas/classSessions';
import { createManualClassSession, listClassSessions } from '../../../../../lib/services/classSessions';

export const GET: APIRoute = async ({ params, url, locals }) =>
  withServiceErrors(async () => {
    const query = listClassSessionsQuerySchema.parse(Object.fromEntries(url.searchParams));
    const db = getDb(env.DB);
    const rows = await listClassSessions(db, locals.user!.id, params.id!, query);
    return apiOk(toApi(rows));
  });

export const POST: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = createClassSessionSchema.parse(body);
    const db = getDb(env.DB);
    const created = await createManualClassSession(db, locals.user!.id, params.id!, input);
    return apiOk(toApi(created), { status: 201 });
  });
