import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { toApi } from '../../../../../../lib/serialize';
import { getConversation } from '../../../../../../lib/services/tutor/conversations';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const conversation = await getConversation(db, locals.user!.id, params.id!);
    return apiOk(toApi(conversation));
  });
