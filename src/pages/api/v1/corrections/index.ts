import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { createCorrectionSchema, listCorrectionsQuerySchema } from '../../../../lib/schemas/corrections';
import { createCorrection, listCorrections } from '../../../../lib/services/corrections';
import { verifyRuntimeConversationProvenance } from '../../../../lib/runtime/tutorRuntime';

export const GET: APIRoute = async ({ url, locals }) =>
  withServiceErrors(async () => {
    const query = listCorrectionsQuerySchema.parse(Object.fromEntries(url.searchParams));
    const db = getDb(env.DB);
    const rows = await listCorrections(db, locals.user!.id, query);
    return apiOk(toApi(rows));
  });

export const POST: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = createCorrectionSchema.parse(body);
    const db = getDb(env.DB);
    const provenance = input.source_conversation_id
      ? await verifyRuntimeConversationProvenance(db, env, locals.user!.id, input.source_conversation_id)
      : undefined;
    const created = await createCorrection(db, locals.user!.id, input, provenance);
    return apiOk(toApi(created), { status: 201 });
  });
