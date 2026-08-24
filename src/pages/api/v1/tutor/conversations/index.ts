import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { createConversationSchema, listConversationsQuerySchema } from '../../../../../lib/schemas/tutor';
import { createRuntimeConversation, listRuntimeConversations } from '../../../../../lib/runtime/tutorRuntime';

export const GET: APIRoute = async ({ url, locals }) =>
  withServiceErrors(async () => {
    const query = listConversationsQuerySchema.parse(Object.fromEntries(url.searchParams));
    const db = getDb(env.DB);
    const conversations = await listRuntimeConversations(db, env, locals.user!.id, query);
    return apiOk({ conversations: toApi(conversations) });
  });

export const POST: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = createConversationSchema.parse(body);
    const db = getDb(env.DB);
    const conversation = await createRuntimeConversation(db, env, locals.user!.id, input);
    return apiOk(toApi(conversation), { status: 201 });
  });
