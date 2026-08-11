import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { createConversationSchema } from '../../../../../lib/schemas/tutor';
import { createConversation } from '../../../../../lib/services/tutor/conversations';

export const POST: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = createConversationSchema.parse(body);
    const db = getDb(env.DB);
    const conversation = await createConversation(db, locals.user!.id, input);
    return apiOk(toApi(conversation), { status: 201 });
  });
