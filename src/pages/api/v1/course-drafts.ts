import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../db/client';
import { apiOk } from '../../../lib/api';
import { withServiceErrors } from '../../../lib/apiErrors';
import { courseDraftV2Schema } from '../../../lib/schemas/courseDraft';
import { persistCourseDraft } from '../../../lib/services/courseDraft';
import { z } from 'zod';

const createSchema = z.strictObject({
  course: courseDraftV2Schema,
  context: z.strictObject({ term: z.string().trim().max(200).optional(), credits: z.number().nonnegative().optional(), instructor: z.string().trim().max(200).optional(), color_hue: z.number().int().min(0).max(359).optional() }).default({}),
});

export const POST: APIRoute = async ({ request, locals }) => withServiceErrors(async () => {
  const input = createSchema.parse(await request.json().catch(() => ({})));
  return apiOk(await persistCourseDraft(getDb(env.DB), locals.user!.id, input.course, {
    ...input.context, color: input.context.color_hue === undefined ? undefined : String(input.context.color_hue),
  }), { status: 201 });
});
