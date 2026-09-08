import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../../../db/client';
import { apiOk } from '../../../../../../lib/api';
import { withServiceErrors } from '../../../../../../lib/apiErrors';
import { toApi } from '../../../../../../lib/serialize';
import { retryCalendarOutboxOperation } from '../../../../../../lib/services/calendarRetry';

export const POST: APIRoute = async ({ locals, params }) =>
  withServiceErrors(async () =>
    apiOk(toApi(await retryCalendarOutboxOperation(getDb(env.DB), locals.user!.id, params.id!))),
  );
