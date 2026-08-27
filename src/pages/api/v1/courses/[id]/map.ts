import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { updateCourseMapSchema } from '../../../../../lib/schemas/courseMap';
import { toApi } from '../../../../../lib/serialize';
import { getCourseMap, syncReviewedTemplateContent, updateCourseMap } from '../../../../../lib/services/courseMap';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    await syncReviewedTemplateContent(db, locals.user!.id, params.id!).catch((error) =>
      console.error('Reviewed template sync failed', error),
    );
    return apiOk(toApi(await getCourseMap(db, locals.user!.id, params.id!)));
  });

export const PUT: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const input = updateCourseMapSchema.parse(await request.json().catch(() => ({})));
    const db = getDb(env.DB);
    return apiOk(toApi(await updateCourseMap(db, locals.user!.id, params.id!, input)));
  });
