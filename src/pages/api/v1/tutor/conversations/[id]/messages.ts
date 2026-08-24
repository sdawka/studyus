// Streaming route — can't use the standard apiOk/withServiceErrors JSON
// wrapper since a successful response is a raw SSE body, not `{data}`. Error
// paths (validation, not-found, cap reached) still return the frozen
// `{error:{code,message}}` envelope.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { ZodError } from 'zod';
import { getDb } from '../../../../../../db/client';
import { apiError } from '../../../../../../lib/api';
import { serviceErrorResponse } from '../../../../../../lib/apiErrors';
import { postMessageSchema } from '../../../../../../lib/schemas/tutor';
import { ConversationCapReachedError } from '../../../../../../lib/services/tutor/conversations';
import { streamRuntimeTutorReply } from '../../../../../../lib/runtime/tutorRuntime';

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const input = postMessageSchema.parse(body);
    const db = getDb(env.DB);
    const stream = await streamRuntimeTutorReply(db, env, locals.user!.id, params.id!, input.content);
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (err) {
    if (err instanceof ConversationCapReachedError) {
      return apiError('conversation_capped', err.message, 400);
    }
    if (err instanceof ZodError) {
      return apiError('invalid_input', err.issues.map((i) => i.message).join('; '), 400);
    }
    return serviceErrorResponse(err);
  }
};
