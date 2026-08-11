import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { updateAssessmentSchema } from '../../../../lib/schemas/assessments';
import { deleteAssessment, updateAssessment } from '../../../../lib/services/assessments';

export const PATCH: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = updateAssessmentSchema.parse(body);
    const db = getDb(env.DB);
    const { assessment, masteryDeltas } = await updateAssessment(db, locals.user!.id, params.id!, input);
    return apiOk({ ...toApi(assessment), mastery_deltas: toApi(masteryDeltas) });
  });

export const DELETE: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    await deleteAssessment(db, locals.user!.id, params.id!);
    return apiOk({});
  });
