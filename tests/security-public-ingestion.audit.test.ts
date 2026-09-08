import { env } from 'cloudflare:test';
import { count } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { demoFunnelEvents } from '../src/db/schema';
import { POST } from '../src/pages/api/public/demo-events';

const db = getDb(env.DB);
let clientAddress: string;
let addressSequence = 0;

function batch(sessionId = crypto.randomUUID(), size = 20) {
  return { events: Array.from({ length: size }, () => ({
    event_id: crypto.randomUUID(), session_id: sessionId,
    name: 'demo_entered', occurred_at: Date.now(),
  })) };
}
async function post(body: unknown, address = clientAddress) {
  // Direct real handler + D1. Anonymous IDs are omitted so no third-party
  // analytics transport is invoked. This does not test Astro's middleware.
  return POST({ request: new Request('https://audit.invalid/api/public/demo-events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), clientAddress: address, locals: { user: null, cfContext: { waitUntil() { throw new Error('Unexpected external delivery'); } } } } as never);
}

beforeEach(async () => {
  clientAddress = `203.0.113.${++addressSequence}`;
  await db.delete(demoFunnelEvents);
});
describe('public ingestion security boundaries', () => {
  it('rejects an oversized event batch without persisting any rows', async () => {
    const response = await post(batch(undefined, 21));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_input' } });
    expect(await db.select().from(demoFunnelEvents)).toEqual([]);
  });

  it('does not persist replayed event IDs twice', async () => {
    const body = batch(undefined, 1);
    expect(await (await post(body)).json()).toMatchObject({ data: { accepted: 1 } });
    expect(await (await post(body)).json()).toMatchObject({ data: { accepted: 0 } });
    expect(await db.select().from(demoFunnelEvents)).toHaveLength(1);
  });

  it('rejects caller-claimed onboarding completion without persisting a conversion', async () => {
    const body = batch(undefined, 1);
    body.events[0].name = 'onboarding_completed';

    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_input' } });
    expect(await db.select().from(demoFunnelEvents)).toHaveLength(0);
  });

  it('rate-limits one edge client independently of caller-minted session identities', async () => {
    for (let request = 0; request < 10; request += 1) {
      expect((await post(batch(undefined, 1))).status).toBe(200);
    }

    const denied = await post(batch(undefined, 1));
    expect(denied.status).toBe(429);
    expect(denied.headers.get('Retry-After')).toBe('60');
    expect(await denied.json()).toMatchObject({ error: { code: 'rate_limited' } });
    expect(await db.select().from(demoFunnelEvents)).toHaveLength(10);
  });
});

describe('concurrent public ingestion quota', () => {
  let persistedCount: number;
  let acceptedCount: number;
  beforeEach(async () => {
    const session = crypto.randomUUID();
    for (let i = 0; i < 4; i++) expect((await post(batch(session))).status).toBe(200);
    const responses = await Promise.all([post(batch(session)), post(batch(session))]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<{ data: { accepted: number } }>));
    acceptedCount = payloads.reduce((total, payload) => total + payload.data.accepted, 0);
    const [total] = await db.select({ n: count() }).from(demoFunnelEvents);
    persistedCount = total.n;
  });
  it('keeps the 100-event session limit under concurrent real D1 requests', () => {
    expect(persistedCount).toBeLessThanOrEqual(100);
    expect(acceptedCount).toBe(20);
  });
});
