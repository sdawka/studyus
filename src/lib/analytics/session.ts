export const ANALYTICS_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ANALYTICS_ANONYMOUS_STORAGE_KEY = 'studyus.analytics.anonymous_id';
export const ANALYTICS_SESSION_STORAGE_KEY = 'studyus.analytics.session';
export const ANALYTICS_ANONYMOUS_COOKIE = 'studyus_anon_id';
export const ANALYTICS_SESSION_COOKIE = 'studyus_session_id';

const ANONYMOUS_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const SESSION_MAX_AGE_SECONDS = ANALYTICS_IDLE_TIMEOUT_MS / 1000;
const safeId = /^[A-Za-z0-9:_-]{1,160}$/;
const safeRoutePattern = /^\/(?!\/)[^?#]{0,199}$/;

export type AnalyticsSessionState = {
  session_id: string;
  last_activity_at: number;
  last_session_started_at: number;
  previous_surface?: string;
};

export type AnalyticsSession = {
  anonymous_id: string;
  session_id: string;
  is_new_session: boolean;
  days_since_last_session?: number;
  previous_surface?: string;
};

function readSafeId(value: string | null | undefined): string | undefined {
  return value && safeId.test(value) ? value : undefined;
}

function readSafeRoutePattern(value: unknown): string | undefined {
  return typeof value === 'string' && safeRoutePattern.test(value) && !value.includes('://') ? value : undefined;
}

function readState(storage: Pick<Storage, 'getItem'>): AnalyticsSessionState | undefined {
  try {
    const parsed = JSON.parse(storage.getItem(ANALYTICS_SESSION_STORAGE_KEY) ?? 'null') as Partial<AnalyticsSessionState> | null;
    if (
      parsed &&
      readSafeId(parsed.session_id) &&
      typeof parsed.last_activity_at === 'number' &&
      Number.isSafeInteger(parsed.last_activity_at) &&
      typeof parsed.last_session_started_at === 'number' &&
      Number.isSafeInteger(parsed.last_session_started_at)
    ) {
      const previousSurface = readSafeRoutePattern(parsed.previous_surface);
      return {
        session_id: parsed.session_id!,
        last_activity_at: parsed.last_activity_at,
        last_session_started_at: parsed.last_session_started_at,
        ...(previousSurface ? { previous_surface: previousSurface } : {}),
      };
    }
  } catch {
    // Corrupt local state is treated as an expired session.
  }
  return undefined;
}

export function resolveAnalyticsSession(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  surface: string,
  now = Date.now(),
  createId: () => string = () => crypto.randomUUID(),
): AnalyticsSession {
  let anonymousId = readSafeId(storage.getItem(ANALYTICS_ANONYMOUS_STORAGE_KEY));
  if (!anonymousId) {
    anonymousId = createId();
    storage.setItem(ANALYTICS_ANONYMOUS_STORAGE_KEY, anonymousId);
  }

  const previous = readState(storage);
  const elapsed = previous ? now - previous.last_activity_at : Number.POSITIVE_INFINITY;
  const isNewSession = !previous || elapsed < 0 || elapsed >= ANALYTICS_IDLE_TIMEOUT_MS;
  const sessionId = isNewSession ? createId() : previous.session_id;
  const daysSinceLastSession =
    isNewSession && previous ? Math.max(0, Math.floor((now - previous.last_session_started_at) / 86_400_000)) : undefined;

  storage.setItem(
    ANALYTICS_SESSION_STORAGE_KEY,
    JSON.stringify({
      session_id: sessionId,
      last_activity_at: now,
      last_session_started_at: isNewSession ? now : previous.last_session_started_at,
      previous_surface: surface,
    } satisfies AnalyticsSessionState),
  );

  return {
    anonymous_id: anonymousId,
    session_id: sessionId,
    is_new_session: isNewSession,
    days_since_last_session: daysSinceLastSession,
    previous_surface: previous?.previous_surface,
  };
}

function cookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function persistAnalyticsCookies(session: AnalyticsSession, secure: boolean, write: (value: string) => void): void {
  write(cookie(ANALYTICS_ANONYMOUS_COOKIE, session.anonymous_id, ANONYMOUS_MAX_AGE_SECONDS, secure));
  write(cookie(ANALYTICS_SESSION_COOKIE, session.session_id, SESSION_MAX_AGE_SECONDS, secure));
}

export function clearAnalyticsState(
  storage: Pick<Storage, 'removeItem'> | undefined,
  secure: boolean,
  write: (value: string) => void,
): void {
  try {
    storage?.removeItem(ANALYTICS_ANONYMOUS_STORAGE_KEY);
    storage?.removeItem(ANALYTICS_SESSION_STORAGE_KEY);
  } catch {
    // Privacy actions must still clear cookies if storage access is blocked.
  }
  write(cookie(ANALYTICS_ANONYMOUS_COOKIE, '', 0, secure));
  write(cookie(ANALYTICS_SESSION_COOKIE, '', 0, secure));
}

export function readAnalyticsCorrelation(cookieHeader: string | null): {
  anonymous_id?: string;
  session_id?: string;
} {
  const values = new Map(
    (cookieHeader ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([name]) => Boolean(name))
      .map(([name, ...parts]) => {
        try {
          return [name, decodeURIComponent(parts.join('='))] as const;
        } catch {
          return [name, ''] as const;
        }
      }),
  );
  return {
    anonymous_id: readSafeId(values.get(ANALYTICS_ANONYMOUS_COOKIE)),
    session_id: readSafeId(values.get(ANALYTICS_SESSION_COOKIE)),
  };
}
