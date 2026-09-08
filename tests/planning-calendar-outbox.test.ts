import { env } from 'cloudflare:test';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import {
  calendarConnections,
  calendarEventLinks,
  calendarOutbox,
  calendarProviderCalendars,
  planningPreferences,
  studySessions,
  users,
} from '../src/db/schema';
import type { CalendarProviderAdapter, CalendarTokenBroker } from '../src/lib/calendar/providers';
import { getCalendar } from '../src/lib/services/calendar';
import { processCalendarOutboxOperation } from '../src/lib/services/calendarOutboxProcessor';
import { enqueueCalendarOperation } from '../src/lib/services/calendarSync';
import { applyPlan, previewPlan, undoPlan, updatePlanningPreferences } from '../src/lib/services/planning';
import { ConflictError } from '../src/lib/services/util';

const db = getDb(env.DB);
const NOW = Date.parse('2027-01-04T13:00:00.000Z');
const availability = [{ day: 1, startMinute: 540, endMinute: 1020 }];
let userId: string;
let sessionId: string;
let connectionId: string;
let calendarId: string;
let originallyScheduled: number;

beforeEach(async () => {
  userId = crypto.randomUUID();
  sessionId = crypto.randomUUID();
  connectionId = crypto.randomUUID();
  calendarId = crypto.randomUUID();
  originallyScheduled = NOW + 2 * 60 * 60_000;
  await db.insert(users).values({ id: userId, clerkUserId: `clerk-${userId}`, email: `${userId}@test.local`, passwordHash: 'x', timezone: 'America/Toronto' });
  await db.insert(calendarConnections).values({ id: connectionId, userId, provider: 'google', externalAccountId: `google-${userId}`, syncMode: 'controlled', status: 'active' });
  await db.insert(calendarProviderCalendars).values({ id: calendarId, connectionId, providerCalendarId: 'studyus-calendar', name: 'Studyus', selected: true, studyusOwned: true });
  await db.insert(studySessions).values({ id: sessionId, userId, intendedEventType: 'practice_done', plannedMinutes: 25, startedAt: originallyScheduled, scheduledAt: originallyScheduled });
  await db.insert(calendarEventLinks).values({ id: crypto.randomUUID(), userId, providerCalendarId: calendarId, providerEventId: 'remote-planned', localEntityType: 'study_session', localEntityId: sessionId, createdAt: NOW });
});

function provider() {
  const adapter: CalendarProviderAdapter = {
    name: 'google',
    sync: vi.fn(),
    upsert: vi.fn().mockResolvedValue({ remoteId: 'remote-restored', etag: 'etag-restored' }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const tokenBroker: CalendarTokenBroker = { getAccessToken: vi.fn().mockResolvedValue('synthetic-token') };
  return { adapter, tokenBroker };
}

async function overflowPreview() {
  const preference = await updatePlanningPreferences(db, userId, { enabled: true, weeklyMinutes: 10, availability, timezone: 'America/Toronto', expectedRevision: 0 }, NOW);
  const preview = await previewPlan(db, userId, NOW);
  expect(preview.changes).toEqual([expect.objectContaining({ kind: 'update', sessionId, after: null })]);
  return { preference, preview };
}

describe('planning calendar outbox integration', () => {
  it('atomically queues and processes a remote delete when a plan becomes unscheduled', async () => {
    const { preference, preview } = await overflowPreview();
    await applyPlan(db, userId, preview.id, preference.revision, NOW + 1);

    const [operation] = await db.select().from(calendarOutbox).where(eq(calendarOutbox.entityId, sessionId));
    expect(operation).toMatchObject({ action: 'delete', connectionId, status: 'pending' });
    expect((await getCalendar(db, userId, NOW, NOW + 86_400_000, undefined, { sweep: false })).find((item) => item.id === sessionId)).toBeUndefined();
    const { adapter, tokenBroker } = provider();
    await processCalendarOutboxOperation(db, operation!.id, { providers: { google: adapter }, tokenBroker }, NOW + 2);
    expect(adapter.delete).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'studyus-calendar', remoteId: 'remote-planned' }));
    expect(adapter.upsert).not.toHaveBeenCalled();
    expect(await db.select().from(calendarEventLinks).where(eq(calendarEventLinks.localEntityId, sessionId))).toEqual([]);
  });

  it('queues and processes an upsert when undo restores the scheduled plan', async () => {
    const { preference, preview } = await overflowPreview();
    await applyPlan(db, userId, preview.id, preference.revision, NOW + 1);
    const [deletion] = await db.select().from(calendarOutbox).where(eq(calendarOutbox.action, 'delete'));
    const first = provider();
    await processCalendarOutboxOperation(db, deletion!.id, { providers: { google: first.adapter }, tokenBroker: first.tokenBroker }, NOW + 2);

    await undoPlan(db, userId, preview.id, NOW + 3);
    const [restoration] = await db.select().from(calendarOutbox).where(eq(calendarOutbox.action, 'upsert'));
    expect(restoration).toMatchObject({ entityId: sessionId, status: 'pending' });
    const second = provider();
    await processCalendarOutboxOperation(db, restoration!.id, { providers: { google: second.adapter }, tokenBroker: second.tokenBroker }, NOW + 4);
    expect(second.adapter.upsert).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'studyus-calendar', event: expect.objectContaining({ localId: sessionId, start: new Date(originallyScheduled).toISOString() }) }));
  });

  it('rolls back every outbox insert when the planning CAS is rejected', async () => {
    const { preference, preview } = await overflowPreview();
    await db.update(planningPreferences).set({ revision: sql`${planningPreferences.revision} + 1` }).where(eq(planningPreferences.userId, userId));
    await expect(applyPlan(db, userId, preview.id, preference.revision, NOW + 1)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.select().from(calendarOutbox).where(eq(calendarOutbox.userId, userId))).toEqual([]);
    expect((await db.select().from(studySessions).where(eq(studySessions.id, sessionId)))[0]).toMatchObject({ scheduledAt: originallyScheduled, planningUnscheduled: false });
  });

  it('turns a stale queued upsert into a delete after the session becomes planning-unscheduled', async () => {
    const operation = await enqueueCalendarOperation(db, userId, connectionId, { action: 'upsert', entity_type: 'study_session', entity_id: sessionId, revision: 'stale-upsert' });
    await db.update(studySessions).set({ scheduledAt: null, planningUnscheduled: true }).where(eq(studySessions.id, sessionId));
    const { adapter, tokenBroker } = provider();
    await processCalendarOutboxOperation(db, operation.id, { providers: { google: adapter }, tokenBroker }, NOW + 1);
    expect(adapter.delete).toHaveBeenCalledOnce();
    expect(adapter.upsert).not.toHaveBeenCalled();
  });
});
