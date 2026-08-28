import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { classSessions } from '../../../../db/schema';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { attendanceToggledEvent, retentionEventSurface } from '../../../../lib/analytics/retention';
import { analyticsRequestCorrelation, queueBehavioralEvent } from '../../../../lib/analytics/server';
import { toApi } from '../../../../lib/serialize';
import { updateClassSessionSchema } from '../../../../lib/schemas/classSessions';
import { countSessionsBehind, updateClassSessionStatus } from '../../../../lib/services/classSessions';
import { resolveSettings } from '../../../../lib/services/user';

export const PATCH: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = updateClassSessionSchema.parse(body);
    const db = getDb(env.DB);
    let previousStatus: typeof classSessions.$inferSelect.status | undefined;
    if (input.status !== undefined) {
      try {
        const [previous] = await db
          .select({ status: classSessions.status })
          .from(classSessions)
          .where(and(eq(classSessions.id, params.id!), eq(classSessions.userId, locals.user!.id)))
          .limit(1);
        previousStatus = previous?.status;
      } catch {
        console.warn(JSON.stringify({ message: 'attendance analytics preflight failed' }));
      }
    }
    const updated = await updateClassSessionStatus(db, locals.user!.id, params.id!, input);
    if (input.status !== undefined && previousStatus !== undefined && previousStatus !== updated.status) {
      try {
        const correlation = analyticsRequestCorrelation(request);
        if (correlation.session_id) {
          const event = attendanceToggledEvent({
            user_id: locals.user!.id,
            session_id: correlation.session_id,
            surface: retentionEventSurface(request, 'attendance'),
            ts: Date.now(),
          }, {
            course_id: updated.courseId,
            status: updated.status,
            sessions_behind: await countSessionsBehind(db, locals.user!.id, updated.courseId),
          });
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
        console.warn(JSON.stringify({ message: 'attendance analytics enrichment failed' }));
      }
    }
    return apiOk(toApi(updated));
  });
