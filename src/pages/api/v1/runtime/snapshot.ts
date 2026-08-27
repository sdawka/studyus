import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { getLearnerRuntimeSnapshot } from '../../../../lib/runtime/tutorRuntime';
import { toApi } from '../../../../lib/serialize';

/** Authenticated, browser-safe projection of the caller's learner DO. */
export const GET: APIRoute = async ({ locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const snapshot = await getLearnerRuntimeSnapshot(db, env, locals.user!.id);
    return apiOk(toApi(snapshot));
  });
