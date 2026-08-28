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
