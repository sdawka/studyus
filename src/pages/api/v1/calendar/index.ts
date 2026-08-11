import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { calendarQuerySchema } from '../../../../lib/schemas/calendar';
import { getCalendar } from '../../../../lib/services/calendar';

export const GET: APIRoute = async ({ url, locals }) =>
  withServiceErrors(async () => {
    const query = calendarQuerySchema.parse(Object.fromEntries(url.searchParams));
    const db = getDb(env.DB);
    const items = await getCalendar(db, locals.user!.id, Date.parse(query.from), Date.parse(query.to), query.course);
    return apiOk(toApi(items));
  });
