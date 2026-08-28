import type { CaptureResult } from 'posthog-js';
import { behavioralSchemaFor, enrichBehavioralEvent, type BehavioralEventInput } from './events';
import { clearAnalyticsState, persistAnalyticsCookies, resolveAnalyticsSession, type AnalyticsSession } from './session';

export type BrowserAnalyticsBootstrap = {
  enabled: boolean;
  host?: string;
  token?: string;
  user_id?: string;
  analytics_opt_out: boolean;
  excluded: boolean;
  surface: string;
};

type PostHog = typeof import('posthog-js').default;

const protocolProperties = new Set([
  'token',
  'distinct_id',
  '$anon_distinct_id',
  '$device_id',
  '$session_id',
  '$window_id',
  '$insert_id',
  '$lib',
  '$lib_version',
  '$process_person_profile',
  '$geoip_disable',
]);

let bootstrap: BrowserAnalyticsBootstrap | undefined;
let instance: PostHog | undefined;
let session: AnalyticsSession | undefined;

function dntEnabled(): boolean {
  return navigator.doNotTrack === '1';
}

function mayCapture(config: BrowserAnalyticsBootstrap): boolean {
  return Boolean(config.enabled && config.host && config.token && !config.analytics_opt_out && !config.excluded && !dntEnabled());
}

function writeCookie(value: string): void {
  document.cookie = value;
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function viewport(): 'mobile' | 'tablet' | 'desktop' {
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1024) return 'tablet';
  return 'desktop';
}

function sanitizeCapture(result: CaptureResult | null): CaptureResult | null {
  if (!result) return null;
  const keptProtocol = Object.fromEntries(Object.entries(result.properties).filter(([key]) => protocolProperties.has(key)));
  keptProtocol.$geoip_disable = true;

  if (result.event === '$identify') {
    return { ...result, properties: keptProtocol, $set: undefined, $set_once: undefined, $unset: undefined };
  }

  const schema = behavioralSchemaFor(result.event);
  if (!schema) return null;
  const allowed = Object.fromEntries(
    Object.keys(schema.shape)
      .filter((key) => key !== 'name' && key in result.properties)
      .map((key) => [key, result.properties[key]]),
  );
  const parsed = schema.safeParse({ name: result.event, ...allowed });
  if (!parsed.success) return null;
  const { name: _name, ...properties } = parsed.data;
  return {
    ...result,
    properties: { ...keptProtocol, ...properties },
    $set: undefined,
    $set_once: undefined,
    $unset: undefined,
  };
}

export async function initializeAnalytics(config: BrowserAnalyticsBootstrap): Promise<void> {
  bootstrap = config;
  if (!mayCapture(config) || instance) {
    if (!mayCapture(config)) clearAnalyticsState(browserStorage(), location.protocol === 'https:', writeCookie);
    return;
  }

  const storage = browserStorage();
  if (!storage) return;
  session = resolveAnalyticsSession(storage, config.surface);
  persistAnalyticsCookies(session, location.protocol === 'https:', writeCookie);

  const posthog = (await import('posthog-js')).default;
  instance = posthog.init(config.token!, {
    api_host: config.host,
    autocapture: false,
    rageclick: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_performance: false,
    capture_exceptions: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_surveys_automatic_display: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    advanced_disable_toolbar_metrics: true,
    advanced_disable_flags: true,
    advanced_enable_surveys: false,
    remote_config_refresh_interval_ms: 0,
    save_referrer: false,
    save_campaign_params: false,
    detect_google_search_app: false,
    disable_scroll_properties: true,
    logs: { captureConsoleLogs: false },
    ip: false,
    respect_dnt: true,
    opt_out_capturing_by_default: false,
    person_profiles: 'identified_only',
    property_denylist: ['$current_url', '$referrer', '$referring_domain', '$pathname', '$host'],
    bootstrap: config.user_id ? undefined : { distinctID: session.anonymous_id, isIdentifiedID: false },
    before_send: sanitizeCapture,
  });
  posthog.opt_in_capturing({ captureEventName: false });
  if (config.user_id) posthog.identify(config.user_id);
}

export function captureBehavioralEvent(input: BehavioralEventInput): void {
  if (!bootstrap || !instance || !mayCapture(bootstrap)) return;
  const storage = browserStorage();
  if (!storage) return;
  session = resolveAnalyticsSession(storage, bootstrap.surface);
  persistAnalyticsCookies(session, location.protocol === 'https:', writeCookie);
  const event = enrichBehavioralEvent(input, {
    user_id: bootstrap.user_id,
    session_id: session.session_id,
    surface: bootstrap.surface,
    ts: Date.now(),
    viewport: viewport(),
  });
  if (!event) return;
  instance.capture(event.name, Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'name')));
}

export function currentAnalyticsSession(): AnalyticsSession | undefined {
  return session;
}

export function setAnalyticsOptOut(optOut: boolean): void {
  if (bootstrap) bootstrap = { ...bootstrap, analytics_opt_out: optOut };
  if (optOut) {
    instance?.reset(true);
    instance?.opt_out_capturing();
    instance = undefined;
    session = undefined;
    clearAnalyticsState(browserStorage(), location.protocol === 'https:', writeCookie);
  } else if (bootstrap) {
    void initializeAnalytics(bootstrap);
  }
}

export function resetAnalytics(): void {
  instance?.reset(true);
  instance = undefined;
  session = undefined;
  if (typeof document !== 'undefined') {
    clearAnalyticsState(browserStorage(), location.protocol === 'https:', writeCookie);
  }
}
