import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { courseDraftV2Schema } from '../../../../../lib/schemas/courseDraft';
import { getCourseDomain, reviseCourseDraft } from '../../../../../lib/services/courseDraft';

export const GET: APIRoute = async ({ locals, params }) => withServiceErrors(async () =>
  apiOk(await getCourseDomain(getDb(env.DB), locals.user!.id, params.id!)));

export const PUT: APIRoute = async ({ request, locals, params }) => withServiceErrors(async () => {
  const draft = courseDraftV2Schema.parse(await request.json().catch(() => ({})));
  return apiOk(await reviseCourseDraft(getDb(env.DB), locals.user!.id, params.id!, draft));
});
