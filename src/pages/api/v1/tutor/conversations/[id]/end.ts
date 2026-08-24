// Additive endpoint beyond the plan draft's three tutor routes: explicit
// end-of-session (self-rating optional). Also triggered automatically when
// the per-conversation message cap is reached (see conversations.ts) — this
// route just exposes the same action for the "End session" UI button.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { toApi } from '../../../../../../lib/serialize';
import { endConversationSchema } from '../../../../../../lib/schemas/tutor';
import { endRuntimeConversation } from '../../../../../../lib/runtime/tutorRuntime';

export const POST: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = endConversationSchema.parse(body);
    const db = getDb(env.DB);
    const result = await endRuntimeConversation(db, env, locals.user!.id, params.id!, input);
    return apiOk(toApi(result));
  });
