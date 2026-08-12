import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { updateCourseSchema } from '../../../../lib/schemas/courses';
import { getCourseBySlug, updateCourse } from '../../../../lib/services/courses';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const course = await getCourseBySlug(db, locals.user!.id, params.slug!);
    return apiOk(toApi(course));
  });

// Documented GET/PATCH asymmetry (docs/api.md "Courses — create/update"):
// GET on this route resolves `:slug` by the course's slug, but PATCH treats
// the same route param as the course *id* — there's no PATCH-by-slug. The
// slug never changes post-create, so callers that just fetched a course by
// slug already have its id in hand to PATCH with instead.
export const PATCH: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = updateCourseSchema.parse(body);
    const db = getDb(env.DB);
    const course = await updateCourse(db, locals.user!.id, params.slug!, input);
    return apiOk(toApi(course));
  });
