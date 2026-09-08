import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { calendarConnections, calendarOutbox, users } from '../../db/schema';
import { ConflictError, NotFoundError } from './util';

/**
 * An owner can explicitly restart a terminal calendar failure after resolving
 * the provider problem. Automatic processing remains capped at ten attempts.
 */
export async function retryCalendarOutboxOperation(db: Db, userId: string, operationId: string, now = Date.now()) {
  const [record] = await db
    .select({ operation: calendarOutbox, connection: calendarConnections, accountState: users.accountState })
    .from(calendarOutbox)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendarOutbox.connectionId))
    .innerJoin(users, eq(users.id, calendarOutbox.userId))
    .where(and(eq(calendarOutbox.id, operationId), eq(calendarOutbox.userId, userId)))
    .limit(1);
  if (!record) throw new NotFoundError('Calendar outbox operation');
  if (record.accountState !== 'active') throw new ConflictError('Calendar account is not active');
  if (record.connection.status !== 'active' || record.connection.syncMode !== 'controlled') {
    throw new ConflictError('Calendar connection is not active for controlled sync');
  }
  if (record.operation.status !== 'failed') throw new ConflictError('Calendar outbox operation is not failed');

  const retried = await db
    .update(calendarOutbox)
    .set({ status: 'pending', attemptCount: 0, availableAt: now, lastError: null, updatedAt: now })
    .where(and(eq(calendarOutbox.id, operationId), eq(calendarOutbox.userId, userId), eq(calendarOutbox.status, 'failed')))
    .returning();
  if (!retried[0]) throw new ConflictError('Calendar outbox operation changed before retry');
  return retried[0];
}
