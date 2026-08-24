import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { toApi } from '../../../../../../lib/serialize';
import { getRuntimeConversation } from '../../../../../../lib/runtime/tutorRuntime';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const conversation = await getRuntimeConversation(db, env, locals.user!.id, params.id!);
    return apiOk(toApi(conversation));
  });
