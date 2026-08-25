import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import { calendarConnections, calendarProviderCalendars, calendarSyncStates, users } from '../src/db/schema';
import {
  CALENDAR_ACTIVITY_STALE_MS,
  CALENDAR_ACTIVITY_RETRY_MS,
  startCalendarActivitySync,
  type CalendarActivityEnvironment,
} from '../src/lib/calendar/activitySync';
import { syncStaleUserCalendars } from '../src/lib/services/calendarActivitySync';

const db = getDb(env.DB);

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function fakeEnvironment(storage = memoryStorage()) {
  const documentListeners = new Map<string, () => void>();
  const windowListeners = new Map<string, () => void>();
  let interval: (() => void) | undefined;
  let intervalDelay: number | undefined;
  let visible = true;
  const dispatchSynced = vi.fn();
  const environment: CalendarActivityEnvironment = {
    get visible() { return visible; },
    storage,
    addDocumentListener: (name, listener) => documentListeners.set(name, listener),
    removeDocumentListener: (name) => documentListeners.delete(name),
    addWindowListener: (name, listener) => windowListeners.set(name, listener),
    removeWindowListener: (name) => windowListeners.delete(name),
    setInterval: (listener, delay) => { interval = listener; intervalDelay = delay; return 1; },
    clearInterval: vi.fn(),
    dispatchSynced,
  };
  return {
    environment,
    setVisible(value: boolean) { visible = value; },
    fireDocument(name: string) { documentListeners.get(name)?.(); },
    fireWindow(name: string) { windowListeners.get(name)?.(); },
    fireInterval() { interval?.(); },
    get intervalDelay() { return intervalDelay; },
    dispatchSynced,
  };
}

describe('calendar activity sync client', () => {
  it('syncs on visible app entry and throttles focus, visibility, and interval triggers for fifteen minutes', async () => {
    let now = 1_000_000;
    const browser = fakeEnvironment();
    const request = vi.fn().mockResolvedValue(true);
    const stop = startCalendarActivitySync({ userKey: 'user-1', environment: browser.environment, request, now: () => now });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(browser.dispatchSynced).toHaveBeenCalledOnce();
    expect(browser.intervalDelay).toBe(60_000);

    browser.fireWindow('focus');
    browser.fireDocument('visibilitychange');
    browser.fireInterval();
    expect(request).toHaveBeenCalledTimes(1);

    now += CALENDAR_ACTIVITY_STALE_MS;
    browser.fireWindow('focus');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    stop();
  });

  it('does no work while hidden and syncs as soon as the app becomes visible again', async () => {
    let now = 1_000_000;
    const browser = fakeEnvironment();
    browser.setVisible(false);
    const request = vi.fn().mockResolvedValue(true);
    const stop = startCalendarActivitySync({ userKey: 'user-1', environment: browser.environment, request, now: () => now });
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();

    now += CALENDAR_ACTIVITY_STALE_MS;
    browser.fireInterval();
    expect(request).not.toHaveBeenCalled();
    browser.setVisible(true);
    browser.fireDocument('visibilitychange');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(browser.dispatchSynced).toHaveBeenCalledOnce();
    stop();
  });

  it('shares a browser lease so two tabs do not start the same sync', async () => {
    const storage = memoryStorage();
    const first = fakeEnvironment(storage);
    const second = fakeEnvironment(storage);
    let release!: () => void;
    const pending = new Promise<boolean>((resolve) => { release = () => resolve(true); });
    const request = vi.fn().mockReturnValue(pending);
    const stopFirst = startCalendarActivitySync({ userKey: 'user-1', environment: first.environment, request, now: () => 1_000_000 });
    const stopSecond = startCalendarActivitySync({ userKey: 'user-1', environment: second.environment, request, now: () => 1_000_000 });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    release();
    await pending;
    stopFirst();
    stopSecond();
  });

  it('backs off briefly after failure without marking the calendar fresh', async () => {
    let now = 1_000_000;
    const browser = fakeEnvironment();
    const request = vi.fn().mockResolvedValue(false);
    const stop = startCalendarActivitySync({ userKey: 'user-1', environment: browser.environment, request, now: () => now });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(browser.dispatchSynced).not.toHaveBeenCalled();

    browser.fireWindow('focus');
    expect(request).toHaveBeenCalledTimes(1);
    now += CALENDAR_ACTIVITY_RETRY_MS;
    browser.fireWindow('focus');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    stop();
  });
});

describe('calendar activity sync server', () => {
  let userId: string;
  let staleCalendarId: string;
  let freshCalendarId: string;

  beforeEach(async () => {
    userId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      clerkUserId: `user_${userId}`,
      email: `${userId}@test.local`,
      passwordHash: 'clerk-managed',
      timezone: 'America/Toronto',
    });
    const connectionId = crypto.randomUUID();
    await db.insert(calendarConnections).values({
      id: connectionId,
      userId,
      provider: 'google',
      externalAccountId: `account-${userId}`,
      syncMode: 'controlled',
      status: 'active',
    });
    staleCalendarId = crypto.randomUUID();
    freshCalendarId = crypto.randomUUID();
    await db.insert(calendarProviderCalendars).values([
      { id: staleCalendarId, connectionId, providerCalendarId: 'stale', name: 'Stale', selected: true },
      { id: freshCalendarId, connectionId, providerCalendarId: 'fresh', name: 'Fresh', selected: true },
    ]);
    await db.insert(calendarSyncStates).values([
      { id: crypto.randomUUID(), providerCalendarId: staleCalendarId, lastSyncedAt: 1_000_000 },
      { id: crypto.randomUUID(), providerCalendarId: freshCalendarId, lastSyncedAt: 2_000_000 },
    ]);
  });

  it('syncs only the authenticated user calendars stale on the server', async () => {
    const syncCalendar = vi.fn().mockResolvedValue({ applied: 2, cursor: 'next' });
    const result = await syncStaleUserCalendars(db, userId, {
      now: 2_000_000,
      staleAfterMs: 500_000,
      providers: {},
      tokenBroker: { getAccessToken: vi.fn() },
      syncCalendar,
    });
    expect(syncCalendar).toHaveBeenCalledTimes(1);
    expect(syncCalendar).toHaveBeenCalledWith(db, staleCalendarId, {}, expect.anything(), expect.objectContaining({ from: expect.any(String), to: expect.any(String) }));
    expect(result).toEqual({ attempted: 1, synced: 1, failed: 0, applied: 2 });
  });
});
