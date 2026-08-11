import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { listCoursesQuerySchema } from '../../../../lib/schemas/courses';
import { listCourses } from '../../../../lib/services/courses';

export const GET: APIRoute = async ({ url, locals }) =>
  withServiceErrors(async () => {
    const query = listCoursesQuerySchema.parse(Object.fromEntries(url.searchParams));
    const db = getDb(env.DB);
    const courses = await listCourses(db, locals.user!.id, { includeMastery: query.include === 'mastery' });
    return apiOk(toApi(courses));
  });
