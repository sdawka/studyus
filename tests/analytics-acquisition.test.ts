import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import { demoFunnelEvents } from '../src/db/schema';
import { buildDemoFunnelBatch } from '../src/lib/analytics/demo';
import { queueBehavioralEvents } from '../src/lib/analytics/server';
import { demoFunnelBatchSchema } from '../src/lib/schemas/onboarding';
import { demoRowsToBehavioralEvents, insertDemoFunnelBatch } from '../src/lib/services/demoFunnel';
import * as demoEventsRoute from '../src/pages/api/public/demo-events';

const db = getDb(env.DB);
const anonymousId = '11111111-1111-4111-8111-111111111111';
const appSessionId = '22222222-2222-4222-8222-222222222222';
const trialSessionId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';
const occurredAt = 1_800_000_000_000;

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } as Pick<Storage, 'getItem' | 'setItem'>;
}

function body() {
  return demoFunnelBatchSchema.parse({
    anonymous_id: anonymousId,
    app_session_id: appSessionId,
    events: [{
      session_id: trialSessionId,
      event_id: eventId,
      name: 'landing_try_clicked',
      occurred_at: occurredAt,
    }],
  });
}

beforeEach(async () => {
  await db.delete(demoFunnelEvents);
});

describe('public demo analytics correlation', () => {
  it('keeps the legacy event shape while accepting optional analytics ids', () => {
    expect(demoFunnelBatchSchema.safeParse({ events: body().events }).success).toBe(true);
    expect(demoFunnelBatchSchema.safeParse(body()).success).toBe(true);
    expect(demoFunnelBatchSchema.safeParse({ ...body(), anonymous_id: 'not-a-uuid' }).success).toBe(false);
    expect(demoFunnelBatchSchema.safeParse({ ...body(), extra: 'private' }).success).toBe(false);
  });

  it('reuses the analytics device/session state and suppresses the request payload under DNT', () => {
    const writes: string[] = [];
    const ids = [anonymousId, appSessionId, eventId];
    const shared = storage();
    const first = buildDemoFunnelBatch(
      { name: 'signup_clicked', trial_session_id: trialSessionId },
      { storage: shared, surface: '/try', now: occurredAt, create_id: () => ids.shift()!, secure: true, write_cookie: (value) => writes.push(value), dnt: false },
    );
    expect(first).toMatchObject({ anonymous_id: anonymousId, app_session_id: appSessionId });
    expect(writes.some((value) => value.startsWith('studyus_trial_handoff=') && value.includes('SameSite=Lax'))).toBe(true);
    expect(buildDemoFunnelBatch(
      { name: 'landing_try_clicked', trial_session_id: trialSessionId },
      { storage: shared, surface: '/try', now: occurredAt, secure: false, write_cookie: vi.fn(), dnt: true },
    )).toBeUndefined();
  });

  it('returns only actual D1 inserts for one-time PostHog mirroring', async () => {
    const first = await insertDemoFunnelBatch(db, body(), occurredAt);
    const replay = await insertDemoFunnelBatch(db, body(), occurredAt);
    expect(first).toMatchObject({ accepted: 1 });
    expect(first.inserted).toHaveLength(1);
    expect(replay).toMatchObject({ accepted: 1, inserted: [] });
    expect(await db.select().from(demoFunnelEvents).where(eq(demoFunnelEvents.id, eventId))).toHaveLength(1);

    const mirrored = demoRowsToBehavioralEvents(first.inserted, appSessionId);
    const replayed = demoRowsToBehavioralEvents(replay.inserted, appSessionId);
    expect(mirrored).toMatchObject([{
      name: 'landing_try_clicked',
      trial_session_id: trialSessionId,
      session_id: appSessionId,
      surface: '/try',
    }]);
    expect(replayed).toEqual([]);
  });

  it('forces demo mirror delivery through /batch/ with the stable anonymous distinct id', async () => {
    const inserted = (await insertDemoFunnelBatch(db, body(), occurredAt)).inserted;
    const pending: Promise<unknown>[] = [];
    let requestUrl = '';
    let requestBody: Record<string, unknown> | undefined;
    queueBehavioralEvents({
      env: { ANALYTICS_ENABLED: 'true', POSTHOG_HOST: 'https://us.i.posthog.com', POSTHOG_PROJECT_TOKEN: 'phc_test' },
      request: new Request('https://studyus.app/api/public/demo-events'),
      execution: { waitUntil: (promise) => pending.push(promise) },
      analytics_opt_out: false,
      anonymous_id: anonymousId,
    }, demoRowsToBehavioralEvents(inserted, appSessionId), {
      force_batch: true,
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body));
        return new Response(null, { status: 200 });
      },
    });
    await pending[0];
    expect(requestUrl).toBe('https://us.i.posthog.com/batch/');
    expect(requestBody).toMatchObject({
      api_key: 'phc_test',
      batch: [{ properties: { distinct_id: anonymousId, $process_person_profile: false } }],
    });
  });

  it('does not write D1 when the endpoint receives DNT', async () => {
    const request = new Request('https://studyus.app/api/public/demo-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', DNT: '1' },
      body: JSON.stringify(body()),
    });
    const response = await demoEventsRoute.POST({
      request,
      locals: { cfContext: { waitUntil: vi.fn() } },
    } as never);
    expect(await response.json()).toEqual({ data: { accepted: 0 } });
    expect(await db.select().from(demoFunnelEvents)).toHaveLength(0);
  });
});
