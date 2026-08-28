import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { courses } from '../../../../db/schema';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { courseArchivedEvent } from '../../../../lib/analytics/retention';
import { analyticsRequestCorrelation, queueBehavioralEvent } from '../../../../lib/analytics/server';
import { toApi } from '../../../../lib/serialize';
import { updateCourseSchema } from '../../../../lib/schemas/courses';
import { getCourseBySlug, updateCourse } from '../../../../lib/services/courses';
import { resolveSettings } from '../../../../lib/services/user';

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
    let previouslyArchived: boolean | undefined;
    if (input.archived === true) {
      try {
        const [previous] = await db
          .select({ archived: courses.archived })
          .from(courses)
          .where(and(eq(courses.id, params.slug!), eq(courses.userId, locals.user!.id)))
          .limit(1);
        previouslyArchived = previous?.archived;
      } catch {
        console.warn(JSON.stringify({ message: 'course archive analytics preflight failed' }));
      }
    }
    const course = await updateCourse(db, locals.user!.id, params.slug!, input);
    if (input.archived === true && previouslyArchived === false && course.archived) {
      try {
        const correlation = analyticsRequestCorrelation(request);
        if (correlation.session_id) {
          const event = courseArchivedEvent({
            user_id: locals.user!.id,
            session_id: correlation.session_id,
            surface: '/api/v1/courses/[slug]',
            ts: Date.now(),
          }, { course_id: course.id, created_at: course.createdAt });
          if (event) {
            queueBehavioralEvent({
              env,
              request,
              execution: locals.cfContext,
              user_id: locals.user!.id,
              analytics_opt_out: resolveSettings(locals.user!.settings).analytics_opt_out,
            }, event);
          }
        }
      } catch {
        console.warn(JSON.stringify({ message: 'course archive analytics queue failed' }));
      }
    }
    return apiOk(toApi(course));
  });
