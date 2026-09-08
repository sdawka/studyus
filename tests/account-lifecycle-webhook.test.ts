import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Webhook } from 'standardwebhooks';
import { getDb } from '../src/db/client';
import { accountDeletionEvents, accountDeletionJobs } from '../src/db/schema';
import { POST } from '../src/pages/api/webhooks/clerk';

const db = getDb(env.DB);
const secret = `whsec_${btoa('01234567890123456789012345678901')}`;

beforeEach(async () => {
  await db.delete(accountDeletionJobs);
  await db.delete(accountDeletionEvents);
  Object.assign(env, { CLERK_WEBHOOK_SIGNING_SECRET: secret });
});

describe('Clerk deletion webhook', () => {
  it('verifies the official signature and durably enqueues the svix event id', async () => {
    const eventId = 'msg_delete_1';
    const timestamp = new Date();
    const body = JSON.stringify({ type: 'user.deleted', data: { id: 'clerk-webhook-user', deleted: true } });
    const signature = new Webhook(secret).sign(eventId, timestamp, body);
    const request = new Request('https://studyus.app/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': eventId,
        'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
        'svix-signature': signature,
      },
      body,
    });

    const response = await POST({ request } as never);
    expect(response.status).toBe(202);
    expect(await db.select().from(accountDeletionEvents).where(eq(accountDeletionEvents.eventId, eventId))).toHaveLength(1);
    expect(await db.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.clerkUserId, 'clerk-webhook-user'))).toHaveLength(1);
  });

  it('rejects an unsigned request without creating a fence', async () => {
    const response = await POST({ request: new Request('https://studyus.app/api/webhooks/clerk', { method: 'POST', body: '{}' }) } as never);
    expect(response.status).toBe(400);
    expect(await db.select().from(accountDeletionEvents)).toEqual([]);
  });
});
