import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { courseDraftV2Schema } from '../../../../../lib/schemas/courseDraft';
import { getCourseAuthoringState, reviseCourseDraft } from '../../../../../lib/services/courseDraft';
import { z } from 'zod';
const updateSchema = z.strictObject({ course: courseDraftV2Schema, expected_revision: z.number().int().nonnegative() });

export const GET: APIRoute = async ({ locals, params }) => withServiceErrors(async () =>
  apiOk(await getCourseAuthoringState(getDb(env.DB), locals.user!.id, params.id!)));

export const PUT: APIRoute = async ({ request, locals, params }) => withServiceErrors(async () => {
  const input = updateSchema.parse(await request.json().catch(() => ({})));
  return apiOk(await reviseCourseDraft(getDb(env.DB), locals.user!.id, params.id!, input.course, input.expected_revision));
});
