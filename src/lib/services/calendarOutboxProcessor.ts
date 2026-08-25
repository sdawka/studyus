import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  calendarConnections,
  calendarEventLinks,
  calendarOutbox,
  calendarProviderCalendars,
  courses,
  studySessions,
  users,
} from '../../db/schema';
import {
  CalendarProviderHttpError,
  ProviderTokenUnavailableError,
  type CalendarProviderAdapter,
  type CalendarProviderName,
  type CalendarTokenBroker,
  type ProviderEventInput,
} from '../calendar/providers';

export type OutboundCalendarProviderRegistry = Partial<Record<CalendarProviderName, CalendarProviderAdapter>>;

export interface CalendarOutboxDependencies {
  providers: OutboundCalendarProviderRegistry;
  tokenBroker: CalendarTokenBroker;
}

export type CalendarOutboxProcessResult = {
  status: 'done' | 'failed' | 'skipped';
  processedCalendars: number;
};

const WRITE_SCOPES: Record<CalendarProviderName, readonly string[]> = {
  google: ['https://www.googleapis.com/auth/calendar.app.created'],
  microsoft: ['Calendars.ReadWrite'],
};

const PROCESSING_LEASE_MS = 5 * 60_000;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 60 * 60_000;

function retryDelay(attemptCount: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1), RETRY_MAX_MS);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function providerVersion(provider: CalendarProviderName, value: string | null | undefined) {
  if (!value) return {};
  return provider === 'google' ? { etag: value } : { changeKey: value };
}

function returnedVersion(
  provider: CalendarProviderName,
  result: { etag?: string; changeKey?: string },
): string | null {
  return provider === 'google' ? result.etag ?? null : result.changeKey ?? null;
}

function deterministicCreateId(entityId: string): string {
  // Google event IDs accept base32hex characters (a-v and 0-9). Studyus IDs
  // are UUIDs today, so removing separators produces a valid, stable remote
  // ID. Microsoft accepts the same value as transactionId.
  const normalized = entityId.toLowerCase().replace(/[^a-v0-9]/g, '');
  if (!normalized) throw new Error('Study session ID cannot produce a provider idempotency key');
  // `stud1` is intentionally base32hex-safe; "studyus" is not (`y` is
  // outside Google's allowed a-v range).
  return `stud1${normalized}`;
}

function isIdempotentDeleteResult(error: unknown): boolean {
  return error instanceof CalendarProviderHttpError && (error.status === 404 || error.status === 410);
}

async function claimOperation(db: Db, operationId: string, now: number) {
  const claimed = await db
    .update(calendarOutbox)
    .set({
      status: 'processing',
      attemptCount: sql`${calendarOutbox.attemptCount} + 1`,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(calendarOutbox.id, operationId),
        or(
          and(
            inArray(calendarOutbox.status, ['pending', 'failed']),
            lte(calendarOutbox.availableAt, now),
          ),
          and(
            eq(calendarOutbox.status, 'processing'),
            lte(calendarOutbox.updatedAt, now - PROCESSING_LEASE_MS),
          ),
        ),
      ),
    )
    .returning();

  const operation = claimed[0];
  if (!operation) return null;
  return operation;
}

async function markDone(db: Db, operationId: string, now: number) {
  await db
    .update(calendarOutbox)
    .set({ status: 'done', lastError: null, updatedAt: now })
    .where(and(eq(calendarOutbox.id, operationId), eq(calendarOutbox.status, 'processing')));
}

async function markFailed(db: Db, operationId: string, attemptCount: number, error: unknown, now: number) {
  await db
    .update(calendarOutbox)
    .set({
      status: 'failed',
      lastError: errorMessage(error),
      availableAt: now + retryDelay(attemptCount),
      updatedAt: now,
    })
    .where(and(eq(calendarOutbox.id, operationId), eq(calendarOutbox.status, 'processing')));
}

async function upsertStudySession(
  db: Db,
  operation: typeof calendarOutbox.$inferSelect,
  calendars: (typeof calendarProviderCalendars.$inferSelect)[],
  adapter: CalendarProviderAdapter,
  accessToken: string,
  now: number,
) {
  const [record] = await db
    .select({ session: studySessions, courseCode: courses.code, timezone: users.timezone })
    .from(studySessions)
    .innerJoin(users, eq(studySessions.userId, users.id))
    .leftJoin(courses, eq(studySessions.courseId, courses.id))
    .where(and(eq(studySessions.id, operation.entityId), eq(studySessions.userId, operation.userId)))
    .limit(1);
  if (!record) throw new Error('Study session not found');

  const startAt = record.session.scheduledAt ?? record.session.startedAt;
  const endAt = record.session.endedAt ?? startAt + (record.session.plannedMinutes ?? 60) * 60_000;
  const createId = deterministicCreateId(record.session.id);
  const event: ProviderEventInput = {
    localId: record.session.id,
    source: 'study_session',
    title: `Study: ${record.courseCode ?? 'General'}`,
    start: new Date(startAt).toISOString(),
    end: new Date(endAt).toISOString(),
    allDay: false,
    timezone: record.timezone,
    transactionId: createId,
  };

  for (const calendar of calendars) {
    const [link] = await db
      .select()
      .from(calendarEventLinks)
      .where(
        and(
          eq(calendarEventLinks.userId, operation.userId),
          eq(calendarEventLinks.providerCalendarId, calendar.id),
          eq(calendarEventLinks.localEntityType, 'study_session'),
          eq(calendarEventLinks.localEntityId, operation.entityId),
        ),
      )
      .limit(1);

    const result = await adapter.upsert({
      accessToken,
      calendarId: calendar.providerCalendarId,
      event,
      ...(link ? { remoteId: link.providerEventId, ...providerVersion(adapter.name, link.providerVersion) } : {}),
    });
    await db
      .insert(calendarEventLinks)
      .values({
        id: link?.id ?? crypto.randomUUID(),
        userId: operation.userId,
        providerCalendarId: calendar.id,
        providerEventId: result.remoteId,
        localEntityType: 'study_session',
        localEntityId: operation.entityId,
        providerVersion: returnedVersion(adapter.name, result),
        lastSyncedAt: now,
        createdAt: link?.createdAt ?? now,
      })
      .onConflictDoUpdate({
        target: [
          calendarEventLinks.providerCalendarId,
          calendarEventLinks.localEntityType,
          calendarEventLinks.localEntityId,
        ],
        set: {
          providerEventId: result.remoteId,
          providerVersion: returnedVersion(adapter.name, result),
          lastSyncedAt: now,
        },
      });
  }
}

async function deleteStudySession(
  db: Db,
  operation: typeof calendarOutbox.$inferSelect,
  calendars: (typeof calendarProviderCalendars.$inferSelect)[],
  adapter: CalendarProviderAdapter,
  accessToken: string,
) {
  for (const calendar of calendars) {
    const [link] = await db
      .select()
      .from(calendarEventLinks)
      .where(
        and(
          eq(calendarEventLinks.userId, operation.userId),
          eq(calendarEventLinks.providerCalendarId, calendar.id),
          eq(calendarEventLinks.localEntityType, 'study_session'),
          eq(calendarEventLinks.localEntityId, operation.entityId),
        ),
      )
      .limit(1);
    if (!link) continue;

    try {
      await adapter.delete({
        accessToken,
        calendarId: calendar.providerCalendarId,
        remoteId: link.providerEventId,
        ...providerVersion(adapter.name, link.providerVersion),
      });
    } catch (error) {
      if (!isIdempotentDeleteResult(error)) throw error;
    }
    await db.delete(calendarEventLinks).where(eq(calendarEventLinks.id, link.id));
  }
}

export async function processCalendarOutboxOperation(
  db: Db,
  operationId: string,
  dependencies: CalendarOutboxDependencies,
  now = Date.now(),
): Promise<CalendarOutboxProcessResult> {
  const operation = await claimOperation(db, operationId, now);
  if (!operation) return { status: 'skipped', processedCalendars: 0 };

  let processedCalendars = 0;
  try {
    if (operation.entityType !== 'study_session') {
      throw new Error(`Calendar outbox entity ${operation.entityType} is not supported`);
    }
    const [connection] = await db
      .select({ connection: calendarConnections, clerkUserId: users.clerkUserId })
      .from(calendarConnections)
      .innerJoin(users, eq(calendarConnections.userId, users.id))
      .where(
        and(
          eq(calendarConnections.id, operation.connectionId),
          eq(calendarConnections.userId, operation.userId),
        ),
      )
      .limit(1);
    if (!connection) throw new Error('Calendar connection not found');
    if (connection.connection.syncMode !== 'controlled') {
      throw new Error('Calendar connection is not enabled for controlled writes');
    }
    if (!connection.clerkUserId) throw new Error('Calendar owner has no Clerk identity');

    const adapter = dependencies.providers[connection.connection.provider];
    if (!adapter) throw new Error(`Calendar provider ${connection.connection.provider} is not configured`);
    const calendars = await db
      .select()
      .from(calendarProviderCalendars)
      .where(
        and(
          eq(calendarProviderCalendars.connectionId, connection.connection.id),
          eq(calendarProviderCalendars.studyusOwned, true),
        ),
      );
    if (!calendars.length) throw new Error('Connection has no Studyus-owned calendar');

    const accessToken = await dependencies.tokenBroker.getAccessToken(
      connection.clerkUserId,
      connection.connection.provider,
      WRITE_SCOPES[connection.connection.provider],
    );
    if (operation.action === 'upsert') {
      await upsertStudySession(db, operation, calendars, adapter, accessToken, now);
    } else {
      await deleteStudySession(db, operation, calendars, adapter, accessToken);
    }
    processedCalendars = calendars.length;
    await markDone(db, operation.id, now);
    await db
      .update(calendarConnections)
      .set({ status: 'active', lastError: null, updatedAt: now })
      .where(eq(calendarConnections.id, connection.connection.id));
    return { status: 'done', processedCalendars };
  } catch (error) {
    if (error instanceof ProviderTokenUnavailableError) {
      await db
        .update(calendarConnections)
        .set({ status: 'reconnect_required', lastError: error.message, updatedAt: now })
        .where(eq(calendarConnections.id, operation.connectionId));
    }
    await markFailed(db, operation.id, operation.attemptCount, error, now);
    return { status: 'failed', processedCalendars };
  }
}

export async function processCalendarOutbox(
  db: Db,
  dependencies: CalendarOutboxDependencies,
  options: { limit?: number; now?: number; connectionId?: string } = {},
) {
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const due = or(
    and(
      inArray(calendarOutbox.status, ['pending', 'failed']),
      lte(calendarOutbox.availableAt, now),
    ),
    and(
      eq(calendarOutbox.status, 'processing'),
      lte(calendarOutbox.updatedAt, now - PROCESSING_LEASE_MS),
    ),
  );
  const candidates = await db
    .select({ id: calendarOutbox.id })
    .from(calendarOutbox)
    .where(options.connectionId ? and(eq(calendarOutbox.connectionId, options.connectionId), due) : due)
    .orderBy(asc(calendarOutbox.availableAt), asc(calendarOutbox.createdAt))
    .limit(limit);

  let claimed = 0;
  let done = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const result = await processCalendarOutboxOperation(db, candidate.id, dependencies, now);
    if (result.status === 'skipped') continue;
    claimed += 1;
    if (result.status === 'done') done += 1;
    else failed += 1;
  }
  return { claimed, done, failed };
}
