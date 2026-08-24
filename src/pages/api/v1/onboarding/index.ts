import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { getOnboardingState } from '../../../../lib/services/onboarding';

export const GET: APIRoute = async ({ locals }) => apiOk(await getOnboardingState(getDb(env.DB), locals.user!.id));
