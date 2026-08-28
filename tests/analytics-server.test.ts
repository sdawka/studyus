import { describe, expect, it } from 'vitest';
import { analyticsGate, resolveAnalyticsConfig } from '../src/lib/analytics/config';
import { deliverBehavioralEventAwaited, queueBehavioralEvent, queueBehavioralEvents } from '../src/lib/analytics/server';

const enabledEnv = {
  ANALYTICS_ENABLED: 'true',
  POSTHOG_HOST: 'https://us.i.posthog.com',
  POSTHOG_PROJECT_TOKEN: 'phc_test',
  ANALYTICS_EXCLUDED_USER_IDS: 'local-dev, another-dev',
};
const base = { user_id: 'user-1', session_id: 'session-1', surface: '/dashboard', ts: 1_800_000_000_000 };

describe('analytics gates', () => {
  it('requires an explicit enabled switch and valid host/token', () => {
    expect(resolveAnalyticsConfig({ ANALYTICS_ENABLED: 'true' }).enabled).toBe(false);
    expect(resolveAnalyticsConfig({ ...enabledEnv, ANALYTICS_ENABLED: 'false' }).enabled).toBe(false);
    expect(resolveAnalyticsConfig(enabledEnv).enabled).toBe(true);
  });

  it('honors DNT, user opt-out, and excluded local user ids', () => {
    const config = resolveAnalyticsConfig(enabledEnv);
    expect(analyticsGate(config, { request: new Request('https://studyus.app', { headers: { DNT: '1' } }) })).toBe(false);
    expect(analyticsGate(config, { analytics_opt_out: true })).toBe(false);
    expect(analyticsGate(config, { user_id: 'local-dev' })).toBe(false);
    expect(analyticsGate(config, { user_id: 'user-1' })).toBe(true);
  });
});

describe('Worker analytics transport', () => {
  it('awaits retrying internal delivery with a stable PostHog insert id', async () => {
    let body: Record<string, unknown> | undefined;
    await expect(deliverBehavioralEventAwaited(
      { env: enabledEnv, user_id: 'user-1', analytics_opt_out: false },
      { name: 'tutor_abandoned', ...base, conversation_id: 'conversation-1', turn_count: 2, elapsed_ms: 1_800_000 },
      {
        insert_id: 'tutor-abandoned:conversation-1:message-2',
        fetcher: async (_input, init) => {
          body = JSON.parse(String(init?.body));
          return new Response(null, { status: 200 });
        },
      },
    )).resolves.toBe(true);
    expect(body?.properties).toMatchObject({
      distinct_id: 'user-1',
      $insert_id: 'tutor-abandoned:conversation-1:message-2',
      conversation_id: 'conversation-1',
      turn_count: 2,
      elapsed_ms: 1_800_000,
    });
    expect(JSON.stringify(body)).not.toMatch(/content|message_text|answer|note|email|name/);
  });

  it('queues bounded single-event delivery on waitUntil', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const promises: Promise<unknown>[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(null, { status: 200 });
    };
    const queued = queueBehavioralEvent(
      {
        env: enabledEnv,
        request: new Request('https://studyus.app/dashboard'),
        execution: { waitUntil: (promise) => promises.push(promise) },
        user_id: 'user-1',
        analytics_opt_out: false,
      },
      { name: 'page_viewed', ...base, route: '/dashboard' },
      { fetcher },
    );
    expect(queued).toBe(true);
    expect(promises).toHaveLength(1);
    await promises[0];
    expect(requests[0]?.url).toBe('https://us.i.posthog.com/i/v0/e/');
    expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({ api_key: 'phc_test', event: 'page_viewed' });
    expect(body.properties).toMatchObject({ distinct_id: 'user-1', user_id: 'user-1', session_id: 'session-1', route: '/dashboard' });
  });

  it('uses the batch endpoint and contains delivery failures', async () => {
    const promises: Promise<unknown>[] = [];
    const warnings: unknown[][] = [];
    let endpoint = '';
    const fetcher: typeof fetch = async (input) => {
      endpoint = String(input);
      return new Response(null, { status: 503 });
    };
    expect(
      queueBehavioralEvents(
        {
          env: enabledEnv,
          request: new Request('https://studyus.app/dashboard'),
          execution: { waitUntil: (promise) => promises.push(promise) },
          analytics_opt_out: false,
        },
        [
          { name: 'page_viewed', ...base, route: '/dashboard' },
          { name: 'record_event_opened', ...base },
        ],
        { fetcher, warn: (...args) => warnings.push(args) },
      ),
    ).toBe(true);
    await promises[0];
    expect(endpoint).toBe('https://us.i.posthog.com/batch/');
    expect(warnings).toEqual([['Behavioral analytics delivery failed', { event_count: 2, reason: 'PostHog ingestion returned 503' }]]);
  });

  it('uses the stable anonymous cookie rather than the app session as distinct_id', async () => {
    const promises: Promise<unknown>[] = [];
    let body: Record<string, unknown> | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(null, { status: 200 });
    };
    expect(
      queueBehavioralEvent(
        {
          env: enabledEnv,
          request: new Request('https://studyus.app/try', { headers: { cookie: 'studyus_anon_id=device-1; studyus_session_id=session-1' } }),
          execution: { waitUntil: (promise) => promises.push(promise) },
          analytics_opt_out: false,
        },
        { name: 'page_viewed', session_id: 'session-1', surface: '/try', ts: base.ts, route: '/try' },
        { fetcher },
      ),
    ).toBe(true);
    await promises[0];
    expect(body?.properties).toMatchObject({ distinct_id: 'device-1', session_id: 'session-1', $process_person_profile: false });
  });

  it('does not send anonymous server events without a correlation cookie', () => {
    let waited = false;
    expect(
      queueBehavioralEvent(
        {
          env: enabledEnv,
          request: new Request('https://studyus.app/try'),
          execution: { waitUntil: () => { waited = true; } },
          analytics_opt_out: false,
        },
        { name: 'page_viewed', session_id: 'session-1', surface: '/try', ts: base.ts, route: '/try' },
      ),
    ).toBe(false);
    expect(waited).toBe(false);
  });

  it('does not queue or fetch when configuration or privacy gates reject capture', () => {
    let waited = false;
    let fetched = false;
    const fetcher: typeof fetch = async () => {
      fetched = true;
      return new Response();
    };
    const queued = queueBehavioralEvent(
      {
        env: enabledEnv,
        request: new Request('https://studyus.app/dashboard'),
        execution: { waitUntil: () => { waited = true; } },
        analytics_opt_out: true,
      },
      { name: 'page_viewed', ...base, route: '/dashboard' },
      { fetcher },
    );
    expect(queued).toBe(false);
    expect(waited).toBe(false);
    expect(fetched).toBe(false);
  });
});
