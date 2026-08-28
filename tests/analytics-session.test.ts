import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_ANONYMOUS_COOKIE,
  ANALYTICS_IDLE_TIMEOUT_MS,
  clearAnalyticsState,
  persistAnalyticsCookies,
  readAnalyticsCorrelation,
  resolveAnalyticsSession,
} from '../src/lib/analytics/session';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++]!;
}

describe('analytics session state', () => {
  it('keeps a stable anonymous id and session below the 30 minute boundary', () => {
    const storage = new MemoryStorage();
    const first = resolveAnalyticsSession(storage, '/dashboard', 1_000, ids('anon-1', 'session-1'));
    const second = resolveAnalyticsSession(storage, '/tasks', 1_000 + ANALYTICS_IDLE_TIMEOUT_MS - 1, ids('unused'));
    expect(first).toMatchObject({ anonymous_id: 'anon-1', session_id: 'session-1', is_new_session: true });
    expect(second).toMatchObject({ anonymous_id: 'anon-1', session_id: 'session-1', is_new_session: false });
    expect(second.previous_surface).toBe('/dashboard');
  });

  it('starts a new session at the idle boundary and records prior-session distance', () => {
    const storage = new MemoryStorage();
    resolveAnalyticsSession(storage, '/dashboard', 1_000, ids('anon-1', 'session-1'));
    const next = resolveAnalyticsSession(storage, '/dashboard', 1_000 + 2 * 86_400_000, ids('session-2'));
    expect(next).toMatchObject({ anonymous_id: 'anon-1', session_id: 'session-2', is_new_session: true, days_since_last_session: 2 });
  });

  it('drops a corrupted raw-URL referrer while preserving otherwise valid session state', () => {
    const storage = new MemoryStorage();
    storage.setItem('studyus.analytics.anonymous_id', 'anon-1');
    storage.setItem('studyus.analytics.session', JSON.stringify({
      session_id: 'session-1',
      last_activity_at: 1_000,
      last_session_started_at: 1_000,
      previous_surface: '/courses/private?token=secret',
    }));

    const session = resolveAnalyticsSession(storage, '/dashboard', 2_000, ids('unused'));
    expect(session).toMatchObject({ session_id: 'session-1', is_new_session: false });
    expect(session.previous_surface).toBeUndefined();
  });

  it('uses SameSite cookies for request correlation and clears owned state', () => {
    const storage = new MemoryStorage();
    const session = resolveAnalyticsSession(storage, '/dashboard', 1_000, ids('anon-1', 'session-1'));
    const writes: string[] = [];
    persistAnalyticsCookies(session, true, (value) => writes.push(value));
    expect(writes).toHaveLength(2);
    expect(writes.every((value) => value.includes('SameSite=Lax') && value.includes('; Secure'))).toBe(true);
    expect(readAnalyticsCorrelation(`${ANALYTICS_ANONYMOUS_COOKIE}=anon-1; studyus_session_id=session-1`)).toEqual({
      anonymous_id: 'anon-1',
      session_id: 'session-1',
    });
    clearAnalyticsState(storage, true, (value) => writes.push(value));
    expect(storage.values.size).toBe(0);
    expect(writes.slice(-2).every((value) => value.includes('Max-Age=0'))).toBe(true);
  });
});
