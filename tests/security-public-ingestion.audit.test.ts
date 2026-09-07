import { env } from 'cloudflare:test';
import { count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { demoFunnelEvents } from '../src/db/schema';
import { POST } from '../src/pages/api/public/demo-events';

const db = getDb(env.DB);
function batch(sessionId = crypto.randomUUID(), size = 20) {
  return { events: Array.from({ length: size }, () => ({
    event_id: crypto.randomUUID(), session_id: sessionId,
    name: 'onboarding_completed', occurred_at: Date.now(),
  })) };
}
async function post(body: unknown) {
  // Direct real handler + D1. Anonymous IDs are omitted so no third-party
  // analytics transport is invoked. This does not test Astro's middleware.
  return POST({ request: new Request('https://audit.invalid/api/public/demo-events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), locals: { user: null, cfContext: { waitUntil() { throw new Error('Unexpected external delivery'); } } } } as never);
}

beforeEach(async () => { await db.delete(demoFunnelEvents); });
describe('public ingestion security boundaries', () => {
  it('rejects an oversized event batch without persisting any rows', async () => {
    const response = await post(batch(undefined, 21));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_input' } });
    expect(await db.select().from(demoFunnelEvents)).toEqual([]);
  });

  it('does not persist replayed event IDs twice', async () => {
    const body = batch(undefined, 1);
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect(await db.select().from(demoFunnelEvents)).toHaveLength(1);
  });

  it('documents that anonymous callers can mint a fresh quota and claimed onboarding completion', async () => {
    // Bounded characterization of the current weakness, not load testing or
    // an endorsement of this policy. Only 101 synthetic rows are inserted.
    const session = crypto.randomUUID();
    for (let i = 0; i < 5; i++) expect((await post(batch(session))).status).toBe(200);
    expect(await (await post(batch(session, 1))).json()).toMatchObject({ data: { accepted: 0 } });
    expect(await (await post(batch(undefined, 1))).json()).toMatchObject({ data: { accepted: 1 } });
    const [total] = await db.select({ n: count() }).from(demoFunnelEvents);
    expect(total.n).toBe(101);
    expect(await db.select().from(demoFunnelEvents).where(eq(demoFunnelEvents.name, 'onboarding_completed'))).toHaveLength(101);
  });
});

describe('concurrent public ingestion quota', () => {
  let persistedCount: number;
  beforeEach(async () => {
    const session = crypto.randomUUID();
    for (let i = 0; i < 4; i++) expect((await post(batch(session))).status).toBe(200);
    const responses = await Promise.all([post(batch(session)), post(batch(session))]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const [total] = await db.select({ n: count() }).from(demoFunnelEvents);
    persistedCount = total.n;
  });
  it.fails('keeps the 100-event session limit under concurrent real D1 requests', () => {
    expect(persistedCount).toBeLessThanOrEqual(100);
  });
});
