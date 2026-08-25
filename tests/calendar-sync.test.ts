import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import {
  calendarConnections,
  calendarEventLinks,
  calendarExternalEvents,
  calendarOutbox,
  calendarProviderCalendars,
  calendarSyncStates,
  studySessions,
  users,
} from '../src/db/schema';
import {
  applyProviderChange,
  createCalendarConnection,
  enqueueCalendarOperation,
  registerProviderCalendar,
} from '../src/lib/services/calendarSync';

const db = getDb(env.DB);

let userId: string;
let connectionId: string;
let providerCalendarId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    clerkUserId: `user_${userId}`,
    email: `${userId}@test.local`,
    passwordHash: 'clerk-managed',
    timezone: 'America/Toronto',
  });

  const connection = await createCalendarConnection(db, userId, {
    provider: 'google',
    external_account_id: `google-${userId}`,
    sync_mode: 'controlled',
  });
  connectionId = connection.id;

  const calendar = await registerProviderCalendar(db, userId, connectionId, {
    provider_calendar_id: `calendar-${userId}`,
    name: 'Studyus',
    timezone: 'America/Toronto',
    selected: true,
    studyus_owned: true,
  });
  providerCalendarId = calendar.id;
});

describe('calendar sync persistence', () => {
  it('stores connection identity and state without storing OAuth credentials', async () => {
    const rows = await db.select().from(calendarConnections);
    const row = rows.find((item) => item.id === connectionId)!;

    expect(row).toMatchObject({
      userId,
      provider: 'google',
      syncMode: 'controlled',
      status: 'active',
    });
    expect(Object.keys(row)).not.toContain('accessToken');
    expect(Object.keys(row)).not.toContain('refreshToken');
  });

  it('registers provider calendars idempotently and creates one cursor row', async () => {
    const again = await registerProviderCalendar(db, userId, connectionId, {
      provider_calendar_id: `calendar-${userId}`,
      name: 'Studyus renamed',
      timezone: 'America/Toronto',
      selected: true,
      studyus_owned: true,
    });

    expect(again.id).toBe(providerCalendarId);
    const calendars = (await db.select().from(calendarProviderCalendars)).filter((row) => row.connectionId === connectionId);
    const states = (await db.select().from(calendarSyncStates)).filter((row) => row.providerCalendarId === providerCalendarId);
    expect(calendars).toHaveLength(1);
    expect(calendars[0].name).toBe('Studyus renamed');
    expect(states).toHaveLength(1);
  });

  it('upserts the same external event instead of duplicating it', async () => {
    const providerEventId = `event-${crypto.randomUUID()}`;
    const firstStart = Date.now() + 60_000;

    await applyProviderChange(db, userId, providerCalendarId, {
      type: 'upsert',
      provider_event_id: providerEventId,
      provider_version: 'etag-1',
      title: 'Work shift',
      start: { kind: 'timed', at: new Date(firstStart).toISOString(), timezone: 'America/Toronto' },
      end: { kind: 'timed', at: new Date(firstStart + 3_600_000).toISOString(), timezone: 'America/Toronto' },
      busy_status: 'busy',
    });
    await applyProviderChange(db, userId, providerCalendarId, {
      type: 'upsert',
      provider_event_id: providerEventId,
      provider_version: 'etag-2',
      title: 'Updated work shift',
      start: { kind: 'timed', at: new Date(firstStart + 60_000).toISOString(), timezone: 'America/Toronto' },
      end: { kind: 'timed', at: new Date(firstStart + 3_660_000).toISOString(), timezone: 'America/Toronto' },
      busy_status: 'busy',
    });

    const rows = (await db.select().from(calendarExternalEvents)).filter((row) => row.providerCalendarId === providerCalendarId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Updated work shift', providerVersion: 'etag-2', status: 'confirmed' });
  });

  it('tombstones provider deletions so incremental replay stays idempotent', async () => {
    const providerEventId = `event-${crypto.randomUUID()}`;
    const start = Date.now() + 60_000;
    await applyProviderChange(db, userId, providerCalendarId, {
      type: 'upsert',
      provider_event_id: providerEventId,
      provider_version: '1',
      title: 'Temporary event',
      start: { kind: 'timed', at: new Date(start).toISOString(), timezone: 'UTC' },
      end: { kind: 'timed', at: new Date(start + 1_800_000).toISOString(), timezone: 'UTC' },
      busy_status: 'busy',
    });
    await applyProviderChange(db, userId, providerCalendarId, {
      type: 'delete',
      provider_event_id: providerEventId,
      provider_version: '2',
    });
    await applyProviderChange(db, userId, providerCalendarId, {
      type: 'delete',
      provider_event_id: providerEventId,
      provider_version: '2',
    });

    const rows = (await db.select().from(calendarExternalEvents)).filter((row) => row.providerEventId === providerEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('cancelled');
  });

  it('accepts remote move/resize for linked Studyus sessions and unschedules remote deletion', async () => {
    const sessionId = crypto.randomUUID();
    const originalStart = Date.now() + 3_600_000;
    await db.insert(studySessions).values({
      id: sessionId,
      userId,
      intendedEventType: 'practice_done',
      plannedMinutes: 30,
      startedAt: originalStart,
      scheduledAt: originalStart,
    });
    const providerEventId = `studyus-${sessionId}`;
    await db.insert(calendarEventLinks).values({
      id: crypto.randomUUID(),
      userId,
      providerCalendarId,
      providerEventId,
      localEntityType: 'study_session',
      localEntityId: sessionId,
      providerVersion: '1',
    });

    const movedStart = originalStart + 86_400_000;
    await applyProviderChange(db, userId, providerCalendarId, {
      type: 'upsert',
      provider_event_id: providerEventId,
      provider_version: '2',
      title: 'Study block',
      start: { kind: 'timed', at: new Date(movedStart).toISOString(), timezone: 'America/Toronto' },
      end: { kind: 'timed', at: new Date(movedStart + 45 * 60_000).toISOString(), timezone: 'America/Toronto' },
      busy_status: 'busy',
    });

    let session = (await db.select().from(studySessions)).find((row) => row.id === sessionId)!;
    expect(session.scheduledAt).toBe(movedStart);
    expect(session.plannedMinutes).toBe(45);

    await applyProviderChange(db, userId, providerCalendarId, {
      type: 'delete',
      provider_event_id: providerEventId,
      provider_version: '3',
    });
    session = (await db.select().from(studySessions)).find((row) => row.id === sessionId)!;
    expect(session.scheduledAt).toBeNull();
  });

  it('deduplicates outbox operations by semantic revision', async () => {
    const entityId = crypto.randomUUID();
    const first = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert',
      entity_type: 'study_session',
      entity_id: entityId,
      revision: '7',
    });
    const second = await enqueueCalendarOperation(db, userId, connectionId, {
      action: 'upsert',
      entity_type: 'study_session',
      entity_id: entityId,
      revision: '7',
    });

    expect(second.id).toBe(first.id);
    const rows = (await db.select().from(calendarOutbox)).filter((row) => row.connectionId === connectionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].dedupeKey).toBe(`${connectionId}:study_session:${entityId}:upsert:7`);
  });
});
