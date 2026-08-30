import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { issueCalendarFeed, revokeCalendarFeed } from '../../../../../lib/services/calendarFeed';

export const POST: APIRoute = async ({ locals, url }) =>
  withServiceErrors(async () => {
    const credential = await issueCalendarFeed(getDb(env.DB), locals.user!.id);
    return apiOk({
      url: `${url.origin}/api/calendar/feed/${credential.token}.ics`,
      warning: 'Anyone with this private URL can read the Studyus calendar. Regenerate it to revoke access.',
    }, { status: 201 });
  });

export const DELETE: APIRoute = async ({ locals }) =>
  withServiceErrors(async () => {
    await revokeCalendarFeed(getDb(env.DB), locals.user!.id);
    return apiOk({ revoked: true });
  });
