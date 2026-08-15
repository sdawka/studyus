// FROZEN CONTRACT (consumed by another track's header/badge UI):
// GET /api/v1/notifications/count -> 200 { data: { unread: <int> } }.
// Deliberately side-effect-free — a single count(*) aggregate, no
// sweepNotifications call — so polling this endpoint (e.g. from a header
// badge) never mints notification rows as a side effect.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { getUnreadNotificationCount } from '../../../../lib/services/notifications';

export const GET: APIRoute = async ({ locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const unread = await getUnreadNotificationCount(db, locals.user!.id);
    return apiOk({ unread });
  });
