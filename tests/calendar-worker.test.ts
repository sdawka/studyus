import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const where = vi.fn().mockResolvedValue([{ id: 'provider-calendar-1' }]);
  const from = vi.fn(() => ({ where }));
  return {
    createClerkClient: vi.fn(() => ({ clerk: true })),
    createGoogleCalendarProvider: vi.fn(() => ({ name: 'google' })),
    createMicrosoftCalendarProvider: vi.fn(() => ({ name: 'microsoft' })),
    createClerkCalendarTokenBroker: vi.fn(() => ({ getAccessToken: vi.fn() })),
    db: { select: vi.fn(() => ({ from })) },
    processCalendarOutbox: vi.fn().mockResolvedValue({ processed: 0 }),
    syncProviderCalendar: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@clerk/backend', () => ({ createClerkClient: mocks.createClerkClient }));
vi.mock('../src/db/client', () => ({ getDb: vi.fn(() => mocks.db) }));
vi.mock('../src/lib/calendar/providers', () => ({
  createClerkCalendarTokenBroker: mocks.createClerkCalendarTokenBroker,
  createGoogleCalendarProvider: mocks.createGoogleCalendarProvider,
  createMicrosoftCalendarProvider: mocks.createMicrosoftCalendarProvider,
}));
vi.mock('../src/lib/services/calendarOutboxProcessor', () => ({
  processCalendarOutbox: mocks.processCalendarOutbox,
}));
vi.mock('../src/lib/services/calendarSyncEngine', () => ({
  syncProviderCalendar: mocks.syncProviderCalendar,
}));

import { createCalendarScheduledHandler } from '../src/lib/services/calendarScheduled';

describe('calendar outbox scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drains pending outbound writes without importing provider calendars', async () => {
    let scheduledWork: Promise<unknown> | undefined;
    const context = {
      waitUntil(promise: Promise<unknown>) {
        scheduledWork = promise;
      },
    };
    const handler = createCalendarScheduledHandler();

    handler(
      { scheduledTime: Date.parse('2026-08-25T12:30:00Z') } as ScheduledController,
      { CLERK_SECRET_KEY: 'test-secret', DB: {} } as Cloudflare.Env,
      context as ExecutionContext,
    );
    await scheduledWork;

    expect(mocks.processCalendarOutbox).toHaveBeenCalledOnce();
    expect(mocks.processCalendarOutbox).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({
        providers: expect.objectContaining({ google: expect.anything(), microsoft: expect.anything() }),
        tokenBroker: expect.anything(),
      }),
      { limit: 100 },
    );
    expect(mocks.db.select).not.toHaveBeenCalled();
    expect(mocks.syncProviderCalendar).not.toHaveBeenCalled();
  });
});
