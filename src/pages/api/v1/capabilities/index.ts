import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getAiCapabilities } from '../../../../lib/ai/capabilities';
import { apiOk } from '../../../../lib/api';

export const GET: APIRoute = async () => apiOk({ ai: getAiCapabilities(env) });
