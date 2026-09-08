import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { calendarConnections, calendarOutbox, users } from '../src/db/schema';
import { retryCalendarOutboxOperation } from '../src/lib/services/calendarRetry';
import { POST } from '../src/pages/api/v1/calendar/outbox/[id]/retry';

const db = getDb(env.DB);
let userId: string;
let otherUserId: string;
let connectionId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  otherUserId = crypto.randomUUID();
  connectionId = crypto.randomUUID();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test.local`, passwordHash: 'x' },
    { id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' },
  ]);
  await db.insert(calendarConnections).values({
    id: connectionId, userId, provider: 'google', externalAccountId: `google-${userId}`, syncMode: 'controlled', status: 'active',
  });
});

async function failedOperation() {
  const id = crypto.randomUUID();
  await db.insert(calendarOutbox).values({
    id,
    userId,
    connectionId,
    action: 'upsert',
    entityType: 'study_session',
    entityId: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    dedupeKey: crypto.randomUUID(),
    status: 'failed',
    attemptCount: 10,
    availableAt: Date.now() + 30 * 86_400_000,
    lastError: 'provider unavailable',
  });
  return id;
}

function context(id: string, user = userId) {
  return {
    params: { id },
    request: new Request(`http://local.test/api/v1/calendar/outbox/${id}/retry`, { method: 'POST' }),
    locals: { user: { id: user } },
  } as any;
}

describe('calendar outbox owner retry', () => {
  it('returns a capped failed operation to pending with a fresh automatic retry budget', async () => {
    const id = await failedOperation();

    await expect(retryCalendarOutboxOperation(db, userId, id, 1_800_000_000_000)).resolves.toMatchObject({
      id, status: 'pending', attemptCount: 0, availableAt: 1_800_000_000_000, lastError: null,
    });
  });

  it('does not disclose or mutate another learner outbox operation', async () => {
    const id = await failedOperation();

    await expect(retryCalendarOutboxOperation(db, otherUserId, id)).rejects.toThrow('Calendar outbox operation');
    expect((await db.select().from(calendarOutbox).where(eq(calendarOutbox.id, id)))[0]).toMatchObject({ status: 'failed', attemptCount: 10 });
    expect((await POST(context(id, otherUserId))).status).toBe(404);
  });

  it('rejects retries when the owner account or connection is no longer active', async () => {
    const id = await failedOperation();
    await db.update(calendarConnections).set({ status: 'disconnected' }).where(eq(calendarConnections.id, connectionId));
    await expect(retryCalendarOutboxOperation(db, userId, id)).rejects.toThrow('Calendar connection');

    await db.update(calendarConnections).set({ status: 'active' }).where(eq(calendarConnections.id, connectionId));
    await db.update(users).set({ accountState: 'deleted' }).where(eq(users.id, userId));
    expect((await POST(context(id))).status).toBe(409);
  });
});
