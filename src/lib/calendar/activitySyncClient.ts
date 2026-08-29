import { apiFetch } from '../apiClient';
import { CALENDAR_ACTIVITY_STALE_MS } from './domain';

const CALENDAR_ACTIVITY_LEASE_MS = 60 * 1_000;
export const CALENDAR_ACTIVITY_RETRY_MS = 60 * 1_000;

export interface CalendarActivityEnvironment {
  readonly visible: boolean;
  readonly storage: Storage;
  addDocumentListener(name: 'visibilitychange', listener: () => void): void;
  removeDocumentListener(name: 'visibilitychange', listener: () => void): void;
  addWindowListener(name: 'focus', listener: () => void): void;
  removeWindowListener(name: 'focus', listener: () => void): void;
  setInterval(listener: () => void, delay: number): number;
  clearInterval(id: number): void;
  dispatchSynced?(): void;
}

interface StartOptions {
  userKey: string;
  environment?: CalendarActivityEnvironment;
  request?: () => Promise<boolean>;
  now?: () => number;
  staleAfterMs?: number;
}

function browserEnvironment(): CalendarActivityEnvironment {
  return {
    get visible() { return document.visibilityState === 'visible'; },
    storage: localStorage,
    addDocumentListener: (name, listener) => document.addEventListener(name, listener),
    removeDocumentListener: (name, listener) => document.removeEventListener(name, listener),
    addWindowListener: (name, listener) => window.addEventListener(name, listener),
    removeWindowListener: (name, listener) => window.removeEventListener(name, listener),
    setInterval: (listener, delay) => window.setInterval(listener, delay),
    clearInterval: (id) => window.clearInterval(id),
    dispatchSynced: () => window.dispatchEvent(new CustomEvent('studyus:calendar-synced')),
  };
}

async function requestActivitySync(): Promise<boolean> {
  const result = await apiFetch<{ failed: number }>('/api/v1/calendar/sync', { method: 'POST' }, 'Calendar sync failed.');
  return result.ok && result.data.failed === 0;
}

/** Starts a quiet calendar refresh loop while the authenticated app is active. */
export function startCalendarActivitySync(options: StartOptions): () => void {
  const environment = options.environment ?? browserEnvironment();
  const request = options.request ?? requestActivitySync;
  const now = options.now ?? Date.now;
  const staleAfterMs = options.staleAfterMs ?? CALENDAR_ACTIVITY_STALE_MS;
  const prefix = `studyus:calendar-sync:${options.userKey}`;
  const successKey = `${prefix}:success`;
  const attemptKey = `${prefix}:attempt`;
  const leaseKey = `${prefix}:lease`;
  const owner = crypto.randomUUID();
  let stopped = false;
  let inFlight = false;

  const readNumber = (key: string): number => {
    try { return Number(environment.storage.getItem(key)) || 0; } catch { return 0; }
  };

  const maybeSync = async (): Promise<void> => {
    if (stopped || inFlight || !environment.visible) return;
    const startedAt = now();
    if (startedAt - readNumber(successKey) < staleAfterMs) return;
    if (startedAt - readNumber(attemptKey) < CALENDAR_ACTIVITY_RETRY_MS) return;

    let lease: { owner?: string; expires?: number } = {};
    try { lease = JSON.parse(environment.storage.getItem(leaseKey) ?? '{}') as typeof lease; } catch { /* invalid */ }
    if ((lease.expires ?? 0) > startedAt && lease.owner !== owner) return;
    try {
      environment.storage.setItem(leaseKey, JSON.stringify({ owner, expires: startedAt + CALENDAR_ACTIVITY_LEASE_MS }));
      const claimed = JSON.parse(environment.storage.getItem(leaseKey) ?? '{}') as typeof lease;
      if (claimed.owner !== owner) return;
    } catch {
      // The server also enforces freshness, so unavailable storage is safe.
    }

    inFlight = true;
    try { environment.storage.setItem(attemptKey, String(startedAt)); } catch { /* best effort */ }
    try {
      if (await request()) {
        try { environment.storage.setItem(successKey, String(now())); } catch { /* best effort */ }
        environment.dispatchSynced?.();
      }
    } catch {
      // This background refresh must never interrupt app use.
    } finally {
      inFlight = false;
      try {
        const current = JSON.parse(environment.storage.getItem(leaseKey) ?? '{}') as typeof lease;
        if (current.owner === owner) environment.storage.removeItem(leaseKey);
      } catch { /* best effort */ }
    }
  };

  const onActivity = () => { void maybeSync(); };
  environment.addDocumentListener('visibilitychange', onActivity);
  environment.addWindowListener('focus', onActivity);
  // The gate remains fifteen minutes, but checking once a minute avoids a
  // nearly-thirty-minute worst case when a completed sync falls just after
  // this component's interval origin.
  const intervalId = environment.setInterval(onActivity, Math.min(staleAfterMs, 60_000));
  void maybeSync();

  return () => {
    stopped = true;
    environment.removeDocumentListener('visibilitychange', onActivity);
    environment.removeWindowListener('focus', onActivity);
    environment.clearInterval(intervalId);
  };
}
