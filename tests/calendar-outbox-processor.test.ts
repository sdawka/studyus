import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import {
  calendarConnections,
  calendarEventLinks,
  calendarOutbox,
  calendarProviderCalendars,
  courses,
  studySessions,
  users,
} from '../src/db/schema';
import {
  CalendarProviderHttpError,
  ProviderTokenUnavailableError,
  type CalendarProviderAdapter,
  type CalendarTokenBroker,
} from '../src/lib/calendar/providers';
import { processCalendarOutbox, processCalendarOutboxOperation } from '../src/lib/services/calendarOutboxProcessor';
import { enqueueCalendarOperation } from '../src/lib/services/calendarSync';

const db = getDb(env.DB);

describe('calendar outbox processor', () => {
  let userId: string;
  let clerkUserId: string;
  let connectionId: string;
  let calendarId: string;
  let sessionId: string;
  let scheduledAt: number;

  beforeEach(async () => {
    userId = crypto.randomUUID();
    clerkUserId = `user_${userId}`;
    connectionId = crypto.randomUUID();
    calendarId = crypto.randomUUID();
    sessionId = crypto.randomUUID();
    scheduledAt = Date.parse('2026-09-10T14:00:00Z');
    const courseId = crypto.randomUUID();

    await db.insert(users).values({
      id: userId,
      clerkUserId,
      email: `${userId}@test.local`,
      passwordHash: 'x',
      timezone: 'America/Toronto',
    });
    await db.insert(courses).values({
      id: courseId,
      userId,
      code: 'CHEM 101',
      slug: `chem-${courseId}`,
      title: 'Chemistry',
    });
    await db.insert(calendarConnections).values({
      id: connectionId,
      userId,
      provider: 'google',
      externalAccountId: `google-${userId}`,
      syncMode: 'controlled',
      status: 'active',
    });
    await db.insert(calendarProviderCalendars).values([
      {
        id: calendarId,
        connectionId,
        providerCalendarId: 'studyus-calendar',
        name: 'Studyus',
        timezone: 'America/Toronto',
        selected: true,
        studyusOwned: true,
      },
      {
        id: crypto.randomUUID(),
        connectionId,
        providerCalendarId: 'personal-calendar',
        name: 'Personal',
        selected: true,
        studyusOwned: false,
      },
    ]);
    await db.insert(studySessions).values({
      id: sessionId,
      userId,
      courseId,
      intendedEventType: 'practice_done',
      plannedMinutes: 45,
      startedAt: scheduledAt,
      scheduledAt,
    });
  });

  function dependencies(adapterOverrides: Partial<CalendarProviderAdapter> = {}) {
    const getAccessToken = vi.fn().mockResolvedValue('fresh-google-token');
    const tokenBroker: CalendarTokenBroker = { getAccessToken };
    const adapter: CalendarProviderAdapter = {
      name: 'google',
      sync: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ remoteId: 'remote-study-1', etag: '"etag-1"' }),
      delete: vi.fn().mockResolvedValue(undefined),
      ...adapterOverrides,
    };
    return { adapter, tokenBroker, getAccessToken };
  }

  it('claims an upsert once, writes only to Studyus-owned calendars, and records the provider link', async () => {
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert',
      entity_type: 'study_session',
      entity_id: sessionId,
      revision: '1',
    });
    const { adapter, tokenBroker, getAccessToken } = dependencies();

    const result = await processCalendarOutboxOperation(
      db,
      operation.id,
      { providers: { google: adapter }, tokenBroker },
      scheduledAt - 1_000,
    );

    expect(result).toEqual({ status: 'done', processedCalendars: 1 });
    expect(getAccessToken).toHaveBeenCalledWith(
      clerkUserId,
      'google',
      expect.arrayContaining(['https://www.googleapis.com/auth/calendar.app.created']),
    );
    expect(adapter.upsert).toHaveBeenCalledTimes(1);
    expect(adapter.upsert).toHaveBeenCalledWith({
      accessToken: 'fresh-google-token',
      calendarId: 'studyus-calendar',
      event: expect.objectContaining({
        localId: sessionId,
        source: 'study_session',
        title: 'Study: CHEM 101',
        start: '2026-09-10T14:00:00.000Z',
        end: '2026-09-10T14:45:00.000Z',
        timezone: 'America/Toronto',
        transactionId: expect.stringMatching(/^stud1[0-9a-f]+$/),
      }),
    });

    const [row] = (await db.select().from(calendarOutbox)).filter((item) => item.id === operation.id);
    expect(row).toMatchObject({ status: 'done', attemptCount: 1, lastError: null });
    const links = (await db.select().from(calendarEventLinks)).filter((item) => item.localEntityId === sessionId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      providerCalendarId: calendarId,
      providerEventId: 'remote-study-1',
      providerVersion: '"etag-1"',
    });

    await expect(
      processCalendarOutboxOperation(db, operation.id, { providers: { google: adapter }, tokenBroker }),
    ).resolves.toEqual({ status: 'skipped', processedCalendars: 0 });
    expect(adapter.upsert).toHaveBeenCalledTimes(1);
  });

  it('updates an existing linked event conditionally without creating another link', async () => {
    await db.insert(calendarEventLinks).values({
      id: crypto.randomUUID(),
      userId,
      providerCalendarId: calendarId,
      providerEventId: 'remote-study-1',
      localEntityType: 'study_session',
      localEntityId: sessionId,
      providerVersion: '"etag-1"',
    });
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert',
      entity_type: 'study_session',
      entity_id: sessionId,
      revision: '2',
    });
    const { adapter, tokenBroker } = dependencies({
      upsert: vi.fn().mockResolvedValue({ remoteId: 'remote-study-1', etag: '"etag-2"' }),
    });

    await processCalendarOutboxOperation(db, operation.id, { providers: { google: adapter }, tokenBroker });

    expect(adapter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ remoteId: 'remote-study-1', etag: '"etag-1"' }),
    );
    const links = (await db.select().from(calendarEventLinks)).filter((item) => item.localEntityId === sessionId);
    expect(links).toHaveLength(1);
    expect(links[0].providerVersion).toBe('"etag-2"');
  });

  it('deletes linked provider events idempotently and removes their links', async () => {
    await db.insert(calendarEventLinks).values({
      id: crypto.randomUUID(),
      userId,
      providerCalendarId: calendarId,
      providerEventId: 'remote-study-1',
      localEntityType: 'study_session',
      localEntityId: sessionId,
      providerVersion: '"etag-1"',
    });
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'delete',
      entity_type: 'study_session',
      entity_id: sessionId,
      revision: '3',
    });
    const { adapter, tokenBroker } = dependencies({
      delete: vi.fn().mockRejectedValue(new CalendarProviderHttpError(410, 'Already deleted')),
    });

    const result = await processCalendarOutboxOperation(db, operation.id, {
      providers: { google: adapter },
      tokenBroker,
    });

    expect(result).toEqual({ status: 'done', processedCalendars: 1 });
    expect(adapter.delete).toHaveBeenCalledWith({
      accessToken: 'fresh-google-token',
      calendarId: 'studyus-calendar',
      remoteId: 'remote-study-1',
      etag: '"etag-1"',
    });
    expect((await db.select().from(calendarEventLinks)).filter((item) => item.localEntityId === sessionId)).toHaveLength(0);
  });

  it('records retry state and marks the connection reconnect-required when Clerk has no usable token', async () => {
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert',
      entity_type: 'study_session',
      entity_id: sessionId,
      revision: '4',
    });
    const tokenBroker: CalendarTokenBroker = {
      getAccessToken: vi.fn().mockRejectedValue(new ProviderTokenUnavailableError('google', 'missing_scopes')),
    };
    const adapter = dependencies().adapter;
    const now = Date.now();

    const result = await processCalendarOutboxOperation(
      db,
      operation.id,
      { providers: { google: adapter }, tokenBroker },
      now,
    );

    expect(result.status).toBe('failed');
    const [row] = (await db.select().from(calendarOutbox)).filter((item) => item.id === operation.id);
    expect(row.status).toBe('failed');
    expect(row.attemptCount).toBe(1);
    expect(row.availableAt).toBeGreaterThan(now);
    expect(row.lastError).toContain('missing required scopes');
    const [connection] = (await db.select().from(calendarConnections)).filter((item) => item.id === connectionId);
    expect(connection.status).toBe('reconnect_required');
    expect(adapter.upsert).not.toHaveBeenCalled();

    await expect(
      processCalendarOutboxOperation(db, operation.id, { providers: { google: adapter }, tokenBroker }, now),
    ).resolves.toEqual({ status: 'skipped', processedCalendars: 0 });
  });

  it('drains due operations in bounded batches', async () => {
    await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'batch-1',
    });
    await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'batch-2',
    });
    const { adapter, tokenBroker } = dependencies();

    const result = await processCalendarOutbox(
      db,
      { providers: { google: adapter }, tokenBroker },
      { limit: 1, now: Date.now() },
    );

    expect(result).toEqual({ claimed: 1, done: 1, failed: 0 });
    const rows = (await db.select().from(calendarOutbox)).filter((item) => item.connectionId === connectionId);
    expect(rows.filter((item) => item.status === 'done')).toHaveLength(1);
    expect(rows.filter((item) => item.status === 'pending')).toHaveLength(1);
  });

  it('can drain one connection without processing another user connection', async () => {
    const otherUserId = crypto.randomUUID();
    const otherConnectionId = crypto.randomUUID();
    await db.insert(users).values({
      id: otherUserId,
      clerkUserId: `user_${otherUserId}`,
      email: `${otherUserId}@test.local`,
      passwordHash: 'x',
    });
    await db.insert(calendarConnections).values({
      id: otherConnectionId,
      userId: otherUserId,
      provider: 'google',
      externalAccountId: `google-${otherUserId}`,
      syncMode: 'controlled',
    });
    const ours = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'scoped-ours',
    });
    const theirs = await enqueueCalendarOperation(db, otherUserId, otherConnectionId, {
      action: 'delete', entity_type: 'study_session', entity_id: crypto.randomUUID(), revision: 'scoped-theirs',
    });
    const { adapter, tokenBroker } = dependencies();

    const result = await processCalendarOutbox(
      db,
      { providers: { google: adapter }, tokenBroker },
      { connectionId, now: Date.now() },
    );

    expect(result).toEqual({ claimed: 1, done: 1, failed: 0 });
    const rows = await db.select().from(calendarOutbox);
    expect(rows.find((row) => row.id === ours.id)?.status).toBe('done');
    expect(rows.find((row) => row.id === theirs.id)?.status).toBe('pending');
  });
});
