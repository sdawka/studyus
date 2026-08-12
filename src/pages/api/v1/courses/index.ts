import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { createCourseSchema, listCoursesQuerySchema } from '../../../../lib/schemas/courses';
import { createCourse, listCourses } from '../../../../lib/services/courses';

export const GET: APIRoute = async ({ url, locals }) =>
  withServiceErrors(async () => {
    const query = listCoursesQuerySchema.parse(Object.fromEntries(url.searchParams));
    const db = getDb(env.DB);
    const courses = await listCourses(db, locals.user!.id, { includeMastery: query.include === 'mastery' });
    return apiOk(toApi(courses));
  });

export const POST: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = createCourseSchema.parse(body);
    const db = getDb(env.DB);
    const course = await createCourse(db, locals.user!.id, input);
    return apiOk(toApi(course), { status: 201 });
  });
