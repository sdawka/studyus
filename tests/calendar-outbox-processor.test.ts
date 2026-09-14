import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2040-01-15T14:00:00Z'));
    userId = crypto.randomUUID();
    clerkUserId = `user_${userId}`;
    connectionId = crypto.randomUUID();
    calendarId = crypto.randomUUID();
    sessionId = crypto.randomUUID();
    scheduledAt = Date.now() + 60_000;
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

  afterEach(() => {
    vi.useRealTimers();
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

  it('does not call the provider if deletion begins while obtaining its token', async () => {
    const operation=await enqueueCalendarOperation(db,userId,connectionId,{action:'upsert',entity_type:'study_session',entity_id:sessionId,revision:'delete-race'});
    const {adapter}=dependencies();
    const tokenBroker={getAccessToken:async()=>{await db.update(users).set({accountState:'deleting'}).where(eq(users.id,userId));return 'synthetic-token';}};
    const result=await processCalendarOutboxOperation(db,operation.id,{providers:{google:adapter},tokenBroker});
    expect(result.status).toBe('skipped');
    expect(adapter.upsert).not.toHaveBeenCalled();
    expect(await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.userId,userId))).toEqual([]);
  });
  it('does not persist late provider results after account deletion', async () => {
    const operation=await enqueueCalendarOperation(db,userId,connectionId,{action:'upsert',entity_type:'study_session',entity_id:sessionId,revision:'late-provider'});
    const {adapter,tokenBroker}=dependencies({upsert:async()=>{await db.update(users).set({accountState:'deleting'}).where(eq(users.id,userId));return {remoteId:'synthetic-remote'};}});
    const result=await processCalendarOutboxOperation(db,operation.id,{providers:{google:adapter},tokenBroker});
    expect(result.status).toBe('skipped');
    expect(await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.userId,userId))).toEqual([]);
  });
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
        start: new Date(scheduledAt).toISOString(),
        end: new Date(scheduledAt + 45 * 60_000).toISOString(),
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

  it('reconciles an old delete as an upsert when the session is currently scheduled', async () => {
    await db.insert(calendarEventLinks).values({
      id: crypto.randomUUID(), userId, providerCalendarId: calendarId,
      providerEventId: 'remote-current', localEntityType: 'study_session', localEntityId: sessionId,
      providerVersion: '"current"', lastSyncedAt: scheduledAt - 1_000,
    });
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'delete', entity_type: 'study_session', entity_id: sessionId, revision: 'stale-delete',
    });
    const { adapter, tokenBroker } = dependencies();

    await processCalendarOutboxOperation(db, operation.id, { providers: { google: adapter }, tokenBroker }, scheduledAt);

    expect(adapter.delete).not.toHaveBeenCalled();
    expect(adapter.upsert).toHaveBeenCalledTimes(1);
    expect(await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.localEntityId, sessionId))).toHaveLength(1);
  });

  it('reconciles an old upsert as a delete when the session no longer exists', async () => {
    await db.insert(calendarEventLinks).values({
      id: crypto.randomUUID(), userId, providerCalendarId: calendarId,
      providerEventId: 'remote-removed', localEntityType: 'study_session', localEntityId: sessionId,
      providerVersion: '"removed"', lastSyncedAt: scheduledAt - 1_000,
    });
    await db.delete(studySessions).where(eq(studySessions.id, sessionId));
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'stale-upsert',
    });
    const { adapter, tokenBroker } = dependencies();

    await processCalendarOutboxOperation(db, operation.id, { providers: { google: adapter }, tokenBroker }, scheduledAt);

    expect(adapter.upsert).not.toHaveBeenCalled();
    expect(adapter.delete).toHaveBeenCalledTimes(1);
    expect(await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.localEntityId, sessionId))).toEqual([]);
  });

  it('does not let a failed old delete remove a newer restored projection on retry', async () => {
    await db.insert(calendarEventLinks).values({
      id: crypto.randomUUID(), userId, providerCalendarId: calendarId,
      providerEventId: 'remote-restored', localEntityType: 'study_session', localEntityId: sessionId,
      providerVersion: '"before"', lastSyncedAt: scheduledAt - 1_000,
    });
    await db.update(studySessions).set({ scheduledAt: null, planningUnscheduled: true }).where(eq(studySessions.id, sessionId));
    const oldDelete = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'delete', entity_type: 'study_session', entity_id: sessionId, revision: 'old-delete',
    });
    const providerDelete = vi.fn()
      .mockRejectedValueOnce(new Error('temporary provider failure'))
      .mockResolvedValue(undefined);
    const { adapter, tokenBroker } = dependencies({ delete: providerDelete });
    await processCalendarOutboxOperation(db, oldDelete.id, { providers: { google: adapter }, tokenBroker }, scheduledAt);

    await db.update(studySessions).set({ scheduledAt, planningUnscheduled: false }).where(eq(studySessions.id, sessionId));
    const restored = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'new-upsert',
    });
    await processCalendarOutboxOperation(db, restored.id, { providers: { google: adapter }, tokenBroker }, scheduledAt + 1);
    await processCalendarOutboxOperation(db, oldDelete.id, { providers: { google: adapter }, tokenBroker }, scheduledAt + 60_000);

    expect(providerDelete).toHaveBeenCalledTimes(1);
    expect(adapter.upsert).toHaveBeenCalledTimes(2);
    expect(await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.localEntityId, sessionId))).toHaveLength(1);
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
    await db.update(studySessions).set({ scheduledAt: null, planningUnscheduled: true }).where(eq(studySessions.id, sessionId));
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

  it('does not persist arbitrary provider error text in the retry record', async () => {
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'private-error',
    });
    const { adapter, tokenBroker } = dependencies({
      upsert: vi.fn().mockRejectedValue(new Error('request failed: https://provider.test/?access_token=secret-value')),
    });

    await processCalendarOutboxOperation(db, operation.id, { providers: { google: adapter }, tokenBroker });

    const [row] = await db.select().from(calendarOutbox).where(eq(calendarOutbox.id, operation.id));
    expect(row.lastError).toBe('Calendar operation failed');
    expect(row.lastError).not.toContain('secret-value');
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

  it('caps a cron tick at five operations per learner while preserving the global batch bound', async () => {
    const otherUserId = crypto.randomUUID();
    const otherConnectionId = crypto.randomUUID();
    const otherCalendarId = crypto.randomUUID();
    const otherSessionId = crypto.randomUUID();
    await db.insert(users).values({
      id: otherUserId, clerkUserId: `user_${otherUserId}`, email: `${otherUserId}@test.local`, passwordHash: 'x',
    });
    await db.insert(calendarConnections).values({
      id: otherConnectionId, userId: otherUserId, provider: 'google', externalAccountId: `google-${otherUserId}`, syncMode: 'controlled',
    });
    await db.insert(calendarProviderCalendars).values({
      id: otherCalendarId, connectionId: otherConnectionId, providerCalendarId: 'other-studyus', name: 'Studyus', selected: true, studyusOwned: true,
    });
    await db.insert(studySessions).values({
      id: otherSessionId, userId: otherUserId, intendedEventType: 'practice_done', plannedMinutes: 25, startedAt: scheduledAt, scheduledAt,
    });
    for (let index = 0; index < 6; index += 1) {
      await enqueueCalendarOperation(db, userId, connectionId, {
        action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: `fair-ours-${index}`,
      });
      await enqueueCalendarOperation(db, otherUserId, otherConnectionId, {
        action: 'upsert', entity_type: 'study_session', entity_id: otherSessionId, revision: `fair-theirs-${index}`,
      });
    }
    const { adapter, tokenBroker } = dependencies();

    const result = await processCalendarOutbox(db, { providers: { google: adapter }, tokenBroker }, { limit: 100, now: Date.now() });

    expect(result.claimed).toBeLessThanOrEqual(100);
    const rows = await db.select().from(calendarOutbox);
    expect(rows.filter((row) => row.userId === userId && row.status === 'done')).toHaveLength(5);
    expect(rows.filter((row) => row.userId === otherUserId && row.status === 'done')).toHaveLength(5);
  });

  it('does no provider work for a claimed operation whose account or connection is no longer active', async () => {
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'inactive-fence',
    });
    await db.update(users).set({ accountState: 'deleting' }).where(eq(users.id, userId));
    const { adapter, tokenBroker, getAccessToken } = dependencies();

    await expect(processCalendarOutboxOperation(db, operation.id, { providers: { google: adapter }, tokenBroker })).resolves.toEqual({ status: 'skipped', processedCalendars: 0 });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(adapter.upsert).not.toHaveBeenCalled();
    expect((await db.select().from(calendarOutbox).where(eq(calendarOutbox.id, operation.id)))[0]).toMatchObject({ status: 'done', lastError: 'account_inactive' });
  });

  it('stops disconnected-connection work before acquiring a provider token', async () => {
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'delete', entity_type: 'study_session', entity_id: sessionId, revision: 'connection-fence',
    });
    await db.update(calendarConnections).set({ status: 'disconnected' }).where(eq(calendarConnections.id, connectionId));
    const { adapter, tokenBroker, getAccessToken } = dependencies();

    await expect(processCalendarOutboxOperation(db, operation.id, { providers: { google: adapter }, tokenBroker })).resolves.toEqual({ status: 'skipped', processedCalendars: 0 });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(adapter.delete).not.toHaveBeenCalled();
    expect((await db.select().from(calendarOutbox).where(eq(calendarOutbox.id, operation.id)))[0]).toMatchObject({ status: 'done', lastError: 'connection_inactive' });
  });

  it('records a non-writable connection as a terminal failure without stranding its claim', async () => {
    const now = Date.now();
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'reconnect-required',
    });
    await db.update(calendarConnections).set({ status: 'reconnect_required' }).where(eq(calendarConnections.id, connectionId));
    const { adapter, tokenBroker, getAccessToken } = dependencies();

    await processCalendarOutboxOperation(db, operation.id, { providers: { google: adapter }, tokenBroker }, now);

    expect(getAccessToken).not.toHaveBeenCalled();
    expect(adapter.upsert).not.toHaveBeenCalled();
    expect((await db.select().from(calendarOutbox).where(eq(calendarOutbox.id, operation.id)))[0]).toMatchObject({
      status: 'failed', attemptCount: 10, availableAt: now + 30 * 86_400_000,
    });
  });

  it('prunes completed outbox history after seven days and retains a capped failed operation for owner retry', async () => {
    const now = Date.now();
    const oldDone = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'old-done',
    });
    await db.update(calendarOutbox).set({ status: 'done', updatedAt: now - 7 * 86_400_000 - 1 }).where(eq(calendarOutbox.id, oldDone.id));
    const capped = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'capped-failure',
    });
    await db.update(calendarOutbox).set({ attemptCount: 9 }).where(eq(calendarOutbox.id, capped.id));
    const { adapter, tokenBroker } = dependencies({ upsert: vi.fn().mockRejectedValue(new Error('provider unavailable')) });

    await processCalendarOutbox(db, { providers: { google: adapter }, tokenBroker }, { now, limit: 100 });

    expect(await db.select().from(calendarOutbox).where(eq(calendarOutbox.id, oldDone.id))).toEqual([]);
    expect((await db.select().from(calendarOutbox).where(eq(calendarOutbox.id, capped.id)))[0]).toMatchObject({ status: 'failed', attemptCount: 10, availableAt: now + 30 * 86_400_000 });
  });

  it('prunes terminal failures after the thirty-day owner-retry window', async () => {
    const now = Date.now() + 31 * 86_400_000;
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'expired-failure',
    });
    await db.update(calendarOutbox).set({
      status: 'failed',
      attemptCount: 10,
      availableAt: now - 1,
      updatedAt: now - 30 * 86_400_000 - 1,
    }).where(eq(calendarOutbox.id, operation.id));

    const { adapter, tokenBroker } = dependencies();
    await processCalendarOutbox(db, { providers: { google: adapter }, tokenBroker }, { now, limit: 100 });

    expect(await db.select().from(calendarOutbox).where(eq(calendarOutbox.id, operation.id))).toEqual([]);
  });

  it('does not let an expired worker overwrite the result of a reclaimed lease', async () => {
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'lease-race',
    });
    const now = Date.now();
    let firstStarted!: () => void;
    let rejectFirst!: () => void;
    const firstStart = new Promise<void>((resolve) => { firstStarted = resolve; });
    const firstResult = new Promise<never>((_resolve, reject) => {
      rejectFirst = () => reject(new Error('expired worker failed'));
    });
    const first = dependencies({ upsert: vi.fn(async () => {
      firstStarted();
      return firstResult;
    }) });
    const firstRun = processCalendarOutboxOperation(db, operation.id, {
      providers: { google: first.adapter }, tokenBroker: first.tokenBroker,
    }, now);
    await firstStart;

    await db.update(calendarOutbox).set({ updatedAt: now - 10 * 60_000 }).where(eq(calendarOutbox.id, operation.id));
    let secondStarted!: () => void;
    let finishSecond!: () => void;
    const secondStart = new Promise<void>((resolve) => { secondStarted = resolve; });
    const secondResult = new Promise<{ remoteId: string; etag: string }>((resolve) => {
      finishSecond = () => resolve({ remoteId: 'remote-new-worker', etag: '"etag-new"' });
    });
    const second = dependencies({ upsert: vi.fn(async () => {
      secondStarted();
      return secondResult;
    }) });
    const secondRun = processCalendarOutboxOperation(db, operation.id, {
      providers: { google: second.adapter }, tokenBroker: second.tokenBroker,
    }, now + 1);
    await secondStart;

    rejectFirst();
    await expect(firstRun).resolves.toMatchObject({ status: 'failed' });
    finishSecond();
    await expect(secondRun).resolves.toMatchObject({ status: 'done' });

    expect((await db.select().from(calendarOutbox).where(eq(calendarOutbox.id, operation.id)))[0]).toMatchObject({
      status: 'done', attemptCount: 2, lastError: null,
    });
  });

  it('does not let an expired token failure disable a reclaimed worker connection', async () => {
    const operation = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'token-lease-race',
    });
    const now = Date.now();
    let firstTokenStarted!: () => void;
    let rejectFirstToken!: () => void;
    const firstStart = new Promise<void>((resolve) => { firstTokenStarted = resolve; });
    const firstToken = new Promise<never>((_resolve, reject) => {
      rejectFirstToken = () => reject(new ProviderTokenUnavailableError('google', 'missing_scopes'));
    });
    const first = dependencies();
    const firstRun = processCalendarOutboxOperation(db, operation.id, {
      providers: { google: first.adapter },
      tokenBroker: { getAccessToken: async () => { firstTokenStarted(); return firstToken; } },
    }, now);
    await firstStart;

    await db.update(calendarOutbox).set({ updatedAt: now - 10 * 60_000 }).where(eq(calendarOutbox.id, operation.id));
    let finishSecond!: () => void;
    let secondStarted!: () => void;
    const secondStart = new Promise<void>((resolve) => { secondStarted = resolve; });
    const secondResult = new Promise<{ remoteId: string; etag: string }>((resolve) => {
      finishSecond = () => resolve({ remoteId: 'remote-current-claim', etag: '"current"' });
    });
    const second = dependencies({ upsert: vi.fn(async () => { secondStarted(); return secondResult; }) });
    const secondRun = processCalendarOutboxOperation(db, operation.id, {
      providers: { google: second.adapter }, tokenBroker: second.tokenBroker,
    }, now + 1);
    await secondStart;

    rejectFirstToken();
    await firstRun;
    expect((await db.select().from(calendarConnections).where(eq(calendarConnections.id, connectionId)))[0].status).toBe('active');
    finishSecond();
    await expect(secondRun).resolves.toMatchObject({ status: 'done' });
    expect((await db.select().from(calendarOutbox).where(eq(calendarOutbox.id, operation.id)))[0]).toMatchObject({ status: 'done', attemptCount: 2 });
    expect((await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.localEntityId, sessionId)))[0]).toMatchObject({ providerEventId: 'remote-current-claim' });
  });
});
