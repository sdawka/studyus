import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../db/client';
import { apiOk } from '../../../../../lib/api';
import { withServiceErrors } from '../../../../../lib/apiErrors';
import { kcEventsQuerySchema } from '../../../../../lib/schemas/events';
import { toApi } from '../../../../../lib/serialize';
import { getKcEvents } from '../../../../../lib/services/events';

export const GET: APIRoute = async ({ params, url, locals }) =>
  withServiceErrors(async () => {
    // Zod-validated (400 on a non-numeric or out-of-range value) rather than
    // a raw Number() that could flow a NaN/negative straight into the
    // service's .limit()/.offset() and surface as a 500.
    const query = kcEventsQuerySchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
    });
    const db = getDb(env.DB);
    const rows = await getKcEvents(db, locals.user!.id, params.id!, query);
    return apiOk(toApi(rows));
  });
