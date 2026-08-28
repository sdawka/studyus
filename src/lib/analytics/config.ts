const truthy = new Set(['1', 'true', 'yes', 'on']);

export type AnalyticsEnvironment = {
  ANALYTICS_ENABLED?: string;
  POSTHOG_HOST?: string;
  POSTHOG_PROJECT_TOKEN?: string;
  ANALYTICS_EXCLUDED_USER_IDS?: string;
};

export type AnalyticsConfig = {
  enabled: boolean;
  host?: string;
  token?: string;
  excluded_user_ids: ReadonlySet<string>;
};

export type AnalyticsGateInput = {
  request?: Request;
  user_id?: string;
  analytics_opt_out?: boolean;
};

function validHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function resolveAnalyticsConfig(environment: AnalyticsEnvironment): AnalyticsConfig {
  const token = environment.POSTHOG_PROJECT_TOKEN?.trim() || undefined;
  const host = validHost(environment.POSTHOG_HOST?.trim());
  const enabled = truthy.has(environment.ANALYTICS_ENABLED?.trim().toLowerCase() ?? '') && Boolean(token && host);
  const excluded = new Set(
    (environment.ANALYTICS_EXCLUDED_USER_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return { enabled, host, token, excluded_user_ids: excluded };
}

export function requestPrefersNoTracking(request: Request | undefined): boolean {
  return request?.headers.get('DNT')?.trim() === '1';
}

export function analyticsGate(config: AnalyticsConfig, input: AnalyticsGateInput = {}): boolean {
  return (
    config.enabled &&
    !input.analytics_opt_out &&
    !requestPrefersNoTracking(input.request) &&
    !(input.user_id && config.excluded_user_ids.has(input.user_id))
  );
}
