import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { toApi } from '../../../../../lib/serialize';
import { createAssessmentSchema } from '../../../../../lib/schemas/assessments';
import { createAssessment, listAssessments } from '../../../../../lib/services/assessments';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const rows = await listAssessments(db, locals.user!.id, params.id!);
    return apiOk(toApi(rows));
  });

export const POST: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = createAssessmentSchema.parse(body);
    const db = getDb(env.DB);
    const created = await createAssessment(db, locals.user!.id, params.id!, input);
    return apiOk(toApi(created), { status: 201 });
  });
