import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { updateRitualSchema } from '../../../../lib/schemas/rituals';
import { deleteRitual, getRitual, updateRitual } from '../../../../lib/services/rituals';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const ritual = await getRitual(db, locals.user!.id, params.id!);
    return apiOk(toApi(ritual));
  });

export const PATCH: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = updateRitualSchema.parse(body);
    const db = getDb(env.DB);
    const updated = await updateRitual(db, locals.user!.id, params.id!, input);
    return apiOk(toApi(updated));
  });

export const DELETE: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    await deleteRitual(db, locals.user!.id, params.id!);
    return apiOk({});
  });
