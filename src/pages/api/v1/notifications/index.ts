import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { listNotificationsQuerySchema } from '../../../../lib/schemas/notifications';
import { listNotifications } from '../../../../lib/services/notifications';

export const GET: APIRoute = async ({ url, locals }) =>
  withServiceErrors(async () => {
    const query = listNotificationsQuerySchema.parse({
      unread: url.searchParams.get('unread') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    const db = getDb(env.DB);
    const { notifications, unread_count } = await listNotifications(db, locals.user!.id, {
      unread: query.unread,
      limit: query.limit,
    });
    return apiOk({ notifications: toApi(notifications), unread_count });
  });
