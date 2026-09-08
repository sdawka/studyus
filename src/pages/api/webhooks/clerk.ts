import type { APIRoute } from 'astro';
import { verifyWebhook } from '@clerk/astro/webhooks';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../db/client';
import { enqueueAccountDeletion } from '../../../lib/services/accountLifecycle';

export const POST: APIRoute = async ({ request }) => {
  try {
    const signingSecret = (env as Cloudflare.Env & { CLERK_WEBHOOK_SIGNING_SECRET?: string }).CLERK_WEBHOOK_SIGNING_SECRET;
    const event = await verifyWebhook(request, { signingSecret });
    if (event.type === 'user.deleted') {
      const clerkUserId = event.data.id;
      const eventId = request.headers.get('svix-id');
      if (!clerkUserId || !eventId) return Response.json({ error: 'invalid_event' }, { status: 400 });
      await enqueueAccountDeletion(getDb(env.DB), { eventId, clerkUserId });
    }
    return Response.json({ received: true }, { status: 202 });
  } catch {
    return Response.json({ error: 'invalid_webhook' }, { status: 400 });
  }
};
