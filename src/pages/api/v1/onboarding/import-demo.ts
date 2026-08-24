import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { demoImportSchema } from '../../../../lib/schemas/onboarding';
import { importDemoSetup } from '../../../../lib/services/onboarding';

export const POST: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const input = demoImportSchema.parse(await request.json().catch(() => ({})));
    return apiOk(await importDemoSetup(getDb(env.DB), locals.user!.id, input));
  });
