import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { getMetaSkills, listCapabilities } from '../../../../lib/services/capabilities';

export const GET: APIRoute = async ({ locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const userId = locals.user!.id;
    const [caps, metaSkills] = await Promise.all([listCapabilities(db, userId), getMetaSkills(db, userId)]);
    return apiOk(toApi({ capabilities: caps, meta_skills: metaSkills }));
  });
