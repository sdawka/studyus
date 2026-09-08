import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { createSession } from '../src/lib/services/sessions';
import { GET, POST } from '../src/pages/api/v1/sessions/[id]/timer';
import { users } from '../src/db/schema';

const db = getDb(env.DB);
let userId: string;
let foreignUserId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  foreignUserId = crypto.randomUUID();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test.local`, passwordHash: 'x' },
    { id: foreignUserId, email: `${foreignUserId}@test.local`, passwordHash: 'x' },
  ]);
});

function context(id: string, user = userId, body?: Record<string, unknown>) {
  return {
    params: { id },
    request: new Request(`http://local.test/api/v1/sessions/${id}/timer`, body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : undefined),
    locals: { user: { id: user } },
  } as any;
}

describe('/api/v1/sessions/:id/timer', () => {
  it('returns paused acknowledged timing and starts a device lease', async () => {
    const session = await createSession(db, userId, { intended_event_type: 'practice_done' });

    const initial = await GET(context(session.id));
    expect(initial.status).toBe(200);
    expect((await initial.json()) as unknown).toMatchObject({ data: { state: 'paused', elapsed_ms: 0, sequence: 0, revision: 0 } });

    const resumed = await POST(context(session.id, userId, { operation: 'resume', device_id: 'device-a1' }));
    expect(resumed.status).toBe(200);
    expect((await resumed.json()) as unknown).toMatchObject({ data: { state: 'running', sequence: 0, revision: 1, lease_token: expect.any(String) } });
  });

  it('rejects malformed commands and foreign session access', async () => {
    const session = await createSession(db, userId, { intended_event_type: 'practice_done' });
    expect((await POST(context(session.id, userId, { operation: 'heartbeat', device_id: 'short' }))).status).toBe(400);
    expect((await GET(context(session.id, foreignUserId))).status).toBe(404);
  });
});
