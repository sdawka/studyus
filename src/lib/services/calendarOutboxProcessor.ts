import { and, asc, eq, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {assertCalendarActive,CalendarInactiveError} from './calendarActive';
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
const MAX_AUTOMATIC_ATTEMPTS = 10;
const FAILED_RETAIN_MS = 30 * 86_400_000;
const DONE_RETENTION_MS = 7 * 86_400_000;
const MAX_OPERATIONS_PER_USER = 5;

function retryDelay(attemptCount: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1), RETRY_MAX_MS);
}

function errorMessage(error: unknown): string {
  if (error instanceof CalendarProviderHttpError) {
    return `Calendar provider request failed with status ${error.status}`;
  }
  if (error instanceof ProviderTokenUnavailableError) return error.message;
  return 'Calendar operation failed';
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
            eq(calendarOutbox.status, 'pending'),
            lte(calendarOutbox.availableAt, now),
          ),
          and(
            eq(calendarOutbox.status, 'failed'),
            lt(calendarOutbox.attemptCount, MAX_AUTOMATIC_ATTEMPTS),
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

async function markDone(db: Db, operationId: string, attemptCount: number, now: number) {
  const completed = await db
    .update(calendarOutbox)
    .set({ status: 'done', lastError: null, updatedAt: now })
    .where(and(
      eq(calendarOutbox.id, operationId),
      eq(calendarOutbox.status, 'processing'),
      eq(calendarOutbox.attemptCount, attemptCount),
    ))
    .returning({ id: calendarOutbox.id });
  return completed.length === 1;
}

async function markFailed(
  db: Db,
  operationId: string,
  attemptCount: number,
  error: unknown,
  now: number,
  terminal = false,
) {
  const recordedAttemptCount = terminal ? MAX_AUTOMATIC_ATTEMPTS : attemptCount;
  const failed = await db
    .update(calendarOutbox)
    .set({
      status: 'failed',
      attemptCount: recordedAttemptCount,
      lastError: errorMessage(error),
      availableAt: now + (terminal || attemptCount >= MAX_AUTOMATIC_ATTEMPTS ? FAILED_RETAIN_MS : retryDelay(attemptCount)),
      updatedAt: now,
    })
    .where(and(
      eq(calendarOutbox.id, operationId),
      eq(calendarOutbox.status, 'processing'),
      eq(calendarOutbox.attemptCount, attemptCount),
    ))
    .returning({ id: calendarOutbox.id });
  return failed.length === 1;
}

async function stopInactiveOperation(db: Db, operationId: string, attemptCount: number, reason: string, now: number) {
  await db
    .update(calendarOutbox)
    .set({ status: 'done', lastError: reason, updatedAt: now })
    .where(and(
      eq(calendarOutbox.id, operationId),
      eq(calendarOutbox.status, 'processing'),
      eq(calendarOutbox.attemptCount, attemptCount),
    ));
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

  // A queued upsert can become stale before the worker claims it. Never use
  // startedAt as a fallback for a session the planner explicitly unscheduled;
  // remove any prior remote projection instead.
  if (record.session.planningUnscheduled || record.session.scheduledAt === null) {
    await deleteStudySession(db, operation, calendars, adapter, accessToken);
    return;
  }

  const startAt = record.session.scheduledAt;
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

    await assertCalendarActive(db,operation.userId,operation.connectionId);
    const result = await adapter.upsert({
      accessToken,
      calendarId: calendar.providerCalendarId,
      event,
      ...(link ? { remoteId: link.providerEventId, ...providerVersion(adapter.name, link.providerVersion) } : {}),
    });
    await assertCalendarActive(db,operation.userId,operation.connectionId);
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
      await assertCalendarActive(db,operation.userId,operation.connectionId);
      await adapter.delete({
        accessToken,
        calendarId: calendar.providerCalendarId,
        remoteId: link.providerEventId,
        ...providerVersion(adapter.name, link.providerVersion),
      });
    } catch (error) {
      if (!isIdempotentDeleteResult(error)) throw error;
    }
    await assertCalendarActive(db,operation.userId,operation.connectionId);
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
      .select({ connection: calendarConnections, clerkUserId: users.clerkUserId, accountState: users.accountState })
      .from(calendarConnections)
      .innerJoin(users, eq(calendarConnections.userId, users.id))
      .where(
        and(
          eq(calendarConnections.id, operation.connectionId),
          eq(calendarConnections.userId, operation.userId),
        ),
      )
      .limit(1);
    if (!connection) {
      await stopInactiveOperation(db, operation.id, operation.attemptCount, 'connection_missing', now);
      return { status: 'skipped', processedCalendars: 0 };
    }
    if (connection.accountState !== 'active') {
      await stopInactiveOperation(db, operation.id, operation.attemptCount, 'account_inactive', now);
      return { status: 'skipped', processedCalendars: 0 };
    }
    if (connection.connection.status === 'disconnected') {
      await stopInactiveOperation(db, operation.id, operation.attemptCount, 'connection_inactive', now);
      return { status: 'skipped', processedCalendars: 0 };
    }
    if (connection.connection.status !== 'active') {
      await markFailed(db, operation.id, operation.attemptCount, new Error('Calendar connection is not active'), now, true);
      return { status: 'skipped', processedCalendars: 0 };
    }
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
    // Outbox rows are durable reconciliation requests, not commands to replay
    // blindly. A retry may run after a newer apply/undo changed the session,
    // so the current D1 state decides the provider action.
    const [currentSession] = await db.select({
      scheduledAt: studySessions.scheduledAt,
      planningUnscheduled: studySessions.planningUnscheduled,
    }).from(studySessions).where(and(
      eq(studySessions.id, operation.entityId),
      eq(studySessions.userId, operation.userId),
    )).limit(1);
    if (currentSession && currentSession.scheduledAt !== null && !currentSession.planningUnscheduled) {
      await upsertStudySession(db, operation, calendars, adapter, accessToken, now);
    } else {
      await deleteStudySession(db, operation, calendars, adapter, accessToken);
    }
    processedCalendars = calendars.length;
    const completed = await markDone(db, operation.id, operation.attemptCount, now);
    if (completed) {
      await db
        .update(calendarConnections)
        .set({ status: 'active', lastError: null, updatedAt: now })
        .where(and(
          eq(calendarConnections.id, connection.connection.id),
          eq(calendarConnections.status, 'active'),
          sql`EXISTS (SELECT 1 FROM users WHERE users.id=${operation.userId} AND users.account_state='active')`,
        ));
    }
    return { status: 'done', processedCalendars };
  } catch (error) {
    if(error instanceof CalendarInactiveError){
      await stopInactiveOperation(db,operation.id,operation.attemptCount,'account_or_connection_inactive',now);
      return {status:'skipped',processedCalendars};
    }
    const failed = await markFailed(db, operation.id, operation.attemptCount, error, now);
    if (error instanceof ProviderTokenUnavailableError && failed) {
      await db
        .update(calendarConnections)
        .set({ status: 'reconnect_required', lastError: error.message, updatedAt: now })
        .where(and(
          eq(calendarConnections.id, operation.connectionId),
          eq(calendarConnections.status, 'active'),
          sql`EXISTS (SELECT 1 FROM users WHERE users.id=${operation.userId} AND users.account_state='active')`,
        ));
    }
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
      eq(calendarOutbox.status, 'pending'),
      lte(calendarOutbox.availableAt, now),
    ),
    and(
      eq(calendarOutbox.status, 'failed'),
      lt(calendarOutbox.attemptCount, MAX_AUTOMATIC_ATTEMPTS),
      lte(calendarOutbox.availableAt, now),
    ),
    and(
      eq(calendarOutbox.status, 'processing'),
      lte(calendarOutbox.updatedAt, now - PROCESSING_LEASE_MS),
    ),
  );
  await db
    .delete(calendarOutbox)
    .where(and(eq(calendarOutbox.status, 'done'), lte(calendarOutbox.updatedAt, now - DONE_RETENTION_MS)));
  await db
    .delete(calendarOutbox)
    .where(and(
      eq(calendarOutbox.status, 'failed'),
      eq(calendarOutbox.attemptCount, MAX_AUTOMATIC_ATTEMPTS),
      lte(calendarOutbox.updatedAt, now - FAILED_RETAIN_MS),
    ));

  const dueUsers = await db
    .select({ userId: calendarOutbox.userId })
    .from(calendarOutbox)
    .where(options.connectionId ? and(eq(calendarOutbox.connectionId, options.connectionId), due) : due)
    .groupBy(calendarOutbox.userId)
    .orderBy(asc(sql`min(${calendarOutbox.availableAt})`))
      .limit(limit);

  const candidates: Array<{ id: string }> = [];
  for (const user of dueUsers) {
    const userDue = options.connectionId
      ? and(eq(calendarOutbox.connectionId, options.connectionId), eq(calendarOutbox.userId, user.userId), due)
      : and(eq(calendarOutbox.userId, user.userId), due);
    const rows = await db
      .select({ id: calendarOutbox.id })
      .from(calendarOutbox)
      .where(userDue)
      .orderBy(asc(calendarOutbox.availableAt), asc(calendarOutbox.createdAt))
      .limit(Math.min(MAX_OPERATIONS_PER_USER, limit - candidates.length));
    candidates.push(...rows);
    if (candidates.length >= limit) break;
  }

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
