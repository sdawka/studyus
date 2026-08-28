import { analyticsGate, resolveAnalyticsConfig, type AnalyticsEnvironment, type AnalyticsGateInput } from './config';
import { behavioralEventSchema, type BehavioralEvent } from './events';
import { readAnalyticsCorrelation } from './session';

const DEFAULT_TIMEOUT_MS = 4_000;

export type AnalyticsWaitUntil = Pick<ExecutionContext, 'waitUntil'>;
export type AnalyticsTransportOptions = {
  fetcher?: typeof fetch;
  timeout_ms?: number;
  force_batch?: boolean;
  warn?: (message: string, details: { event_count: number; reason: string }) => void;
};

export type AwaitedAnalyticsTransportOptions = AnalyticsTransportOptions & {
  /** Stable PostHog ingestion identity used by retrying internal producers. */
  insert_id: string;
};

export type ServerAnalyticsContext = Omit<AnalyticsGateInput, 'request' | 'analytics_opt_out'> & {
  env: AnalyticsEnvironment;
  execution: AnalyticsWaitUntil;
  request: Request;
  analytics_opt_out: boolean;
  /** Validated request correlation for clients that cannot rely on Cookie parsing. */
  anonymous_id?: string;
};

function ingestionUrl(host: string, path: '/i/v0/e/' | '/batch/'): string {
  return new URL(path, `${host}/`).toString();
}

function wireEvent(event: BehavioralEvent, anonymousId: string | undefined, insertId?: string) {
  const { name, ts, user_id, ...properties } = event;
  const distinctId = user_id ?? anonymousId;
  if (!distinctId) return undefined;
  return {
    event: name,
    properties: {
      distinct_id: distinctId,
      ...(insertId ? { $insert_id: insertId } : {}),
      ...properties,
      ...(user_id ? { user_id } : { $process_person_profile: false }),
    },
    timestamp: new Date(ts).toISOString(),
  };
}

async function deliver(
  host: string,
  token: string,
  events: BehavioralEvent[],
  anonymousId: string | undefined,
  options: AnalyticsTransportOptions,
  insertId?: string,
): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const single = events.length === 1 && !options.force_batch;
  const wires = events
    .map((event) => wireEvent(event, anonymousId, insertId))
    .filter((wire): wire is NonNullable<typeof wire> => Boolean(wire));
  if (wires.length !== events.length) return;
  const first = wires[0];
  if (!first) return;
  const payload = single
    ? { api_key: token, ...first }
    : {
        api_key: token,
        batch: wires,
      };
  const response = await fetcher(ingestionUrl(host, single ? '/i/v0/e/' : '/batch/'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(options.timeout_ms ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`PostHog ingestion returned ${response.status}`);
  await response.body?.cancel();
}

/**
 * Awaited transport for retrying internal runtimes such as Durable Object
 * alarms. Unlike the request-path queue, failures deliberately propagate so
 * the platform can retry with the same insert id.
 */
export async function deliverBehavioralEventAwaited(
  context: Omit<ServerAnalyticsContext, 'execution' | 'request'> & { request?: Request },
  input: unknown,
  options: AwaitedAnalyticsTransportOptions,
): Promise<boolean> {
  const config = resolveAnalyticsConfig(context.env);
  if (!analyticsGate(config, context) || !config.host || !config.token) return false;
  const parsed = behavioralEventSchema.safeParse(input);
  if (!parsed.success) {
    (options.warn ?? console.warn)('Behavioral analytics event rejected', { event_count: 1, reason: 'schema_rejected' });
    return false;
  }
  const event = parsed.data;
  if (event.user_id && config.excluded_user_ids.has(event.user_id)) return false;
  if (context.user_id && event.user_id && event.user_id !== context.user_id) return false;
  const anonymousId = context.anonymous_id;
  if (!event.user_id && !anonymousId) return false;
  await deliver(config.host, config.token, [event], anonymousId, options, options.insert_id);
  return true;
}

function safeReason(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error && /returned \d{3}$/.test(error.message)) return error.message;
  return 'transport_error';
}

export function queueBehavioralEvents(
  context: ServerAnalyticsContext,
  inputs: readonly unknown[],
  options: AnalyticsTransportOptions = {},
): boolean {
  const config = resolveAnalyticsConfig(context.env);
  if (!analyticsGate(config, context) || !config.host || !config.token || inputs.length === 0) return false;

  const parsed = inputs.map((input) => behavioralEventSchema.safeParse(input));
  if (parsed.some((result) => !result.success)) {
    (options.warn ?? console.warn)('Behavioral analytics event rejected', { event_count: inputs.length, reason: 'schema_rejected' });
    return false;
  }
  const events = parsed.flatMap((result) => (result.success ? [result.data] : []));
  if (events.some((event) => event.user_id && config.excluded_user_ids.has(event.user_id))) return false;
  if (context.user_id && events.some((event) => event.user_id && event.user_id !== context.user_id)) return false;
  const anonymousId = context.anonymous_id ?? readAnalyticsCorrelation(context.request.headers.get('cookie')).anonymous_id;
  if (events.some((event) => !event.user_id) && !anonymousId) return false;
  const task = deliver(config.host, config.token, events, anonymousId, options).catch((error: unknown) => {
    (options.warn ?? console.warn)('Behavioral analytics delivery failed', {
      event_count: events.length,
      reason: safeReason(error),
    });
  });
  context.execution.waitUntil(task);
  return true;
}

export function queueBehavioralEvent(
  context: ServerAnalyticsContext,
  input: unknown,
  options: AnalyticsTransportOptions = {},
): boolean {
  return queueBehavioralEvents(context, [input], options);
}

export function analyticsRequestCorrelation(request: Request) {
  return readAnalyticsCorrelation(request.headers.get('cookie'));
}
