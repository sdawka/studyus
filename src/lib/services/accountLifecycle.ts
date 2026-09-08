import { and, eq, gt, lte, or } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import {
  accountDeletionEvents,
  accountDeletionJobs,
  calendarFeedCredentials,
  calendarOutbox,
  groupEventRsvps,
  groupEvents,
  groupFiles,
  groupInvitations,
  groupMembers,
  groupResources,
  groups,
  learnerRuntimeRegistry,
  sessions,
  users,
} from '../../db/schema';
import type { LearnerAgentStub } from '../runtime/learnerAgent';
import { runBatch } from './util';

export const LEARNER_RUNTIME_NAME_PREFIX = 'learner:';

export function learnerRuntimeObjectName(userId: string): string {
  if (!userId || userId.length > 200) throw new TypeError('userId is invalid');
  return `${LEARNER_RUNTIME_NAME_PREFIX}${userId}`;
}

export class AccountInactiveError extends Error {
  constructor() {
    super('This account is no longer active.');
    this.name = 'AccountInactiveError';
  }
}

export async function ensureActiveRuntimeRegistry(db: Db, userId: string, now = Date.now()) {
  const account = (await db.select({ state: users.accountState }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!account || account.state !== 'active') throw new AccountInactiveError();
  await db.insert(learnerRuntimeRegistry).values({
    userId,
    objectName: learnerRuntimeObjectName(userId),
    state: 'active',
    updatedAt: now,
  }).onConflictDoNothing();
  const registry = (await db.select().from(learnerRuntimeRegistry).where(eq(learnerRuntimeRegistry.userId, userId)).limit(1))[0];
  if (!registry || registry.state !== 'active') throw new AccountInactiveError();
  return registry;
}

export async function assertClerkIdentityMayResolve(db: Db, clerkUserId: string): Promise<void> {
  const fence = await db.select({ clerkUserId: accountDeletionJobs.clerkUserId })
    .from(accountDeletionJobs).where(eq(accountDeletionJobs.clerkUserId, clerkUserId)).limit(1);
  if (fence[0]) throw new AccountInactiveError();
  const received = await db.select({ eventId: accountDeletionEvents.eventId })
    .from(accountDeletionEvents).where(eq(accountDeletionEvents.clerkUserId, clerkUserId)).limit(1);
  if (received[0]) throw new AccountInactiveError();
}

export type AccountDeletionEvent = { eventId: string; clerkUserId: string };

export async function enqueueAccountDeletion(db: Db, input: AccountDeletionEvent, now = Date.now()) {
  if (!input.eventId || !input.clerkUserId) throw new TypeError('Deletion event identity is required');
  const account = (await db.select({ id: users.id }).from(users).where(eq(users.clerkUserId, input.clerkUserId)).limit(1))[0];
  const existingJob = (await db.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.clerkUserId, input.clerkUserId)).limit(1))[0];
  const canonicalEventId = existingJob?.eventId ?? input.eventId;
  const statements: BatchItem<'sqlite'>[] = [
    db.insert(accountDeletionEvents).values({ eventId: input.eventId, clerkUserId: input.clerkUserId, receivedAt: now }).onConflictDoNothing(),
    db.insert(accountDeletionJobs).values({
    clerkUserId: input.clerkUserId,
    userId: account?.id ?? null,
    eventId: canonicalEventId,
    state: 'pending',
    attemptCount: 0,
    availableAt: now,
    updatedAt: now,
    }).onConflictDoNothing(),
    db.update(users).set({ accountState: 'deleting' })
      .where(and(eq(users.clerkUserId, input.clerkUserId), eq(users.accountState, 'active'))),
  ];
  if (account) {
    statements.push(
      db.update(accountDeletionJobs).set({ userId: account.id }).where(eq(accountDeletionJobs.clerkUserId, input.clerkUserId)),
      db.insert(learnerRuntimeRegistry).values({
        userId: account.id,
        objectName: learnerRuntimeObjectName(account.id),
        state: 'deleting',
        deletionEventId: canonicalEventId,
        deletedAt: now,
        updatedAt: now,
      }).onConflictDoNothing(),
      db.update(learnerRuntimeRegistry).set({
        state: 'deleting', deletionEventId: canonicalEventId, deletedAt: now, updatedAt: now,
      }).where(and(eq(learnerRuntimeRegistry.userId, account.id), eq(learnerRuntimeRegistry.state, 'active'))),
      db.delete(sessions).where(eq(sessions.userId, account.id)),
      db.update(calendarFeedCredentials).set({ revokedAt: now, updatedAt: now }).where(eq(calendarFeedCredentials.userId, account.id)),
      db.update(calendarOutbox).set({ status: 'done', lastError: 'account_deleted', updatedAt: now }).where(eq(calendarOutbox.userId, account.id)),
      db.update(groups).set({ ownerUserId: null, state: 'read_only', revision: groups.revision, updatedAt: now }).where(eq(groups.ownerUserId, account.id)),
      db.update(groupResources).set({ authorUserId: null, authorLabel: 'Deleted user', authorDeletedAt: now }).where(eq(groupResources.authorUserId, account.id)),
      db.update(groupFiles).set({ authorUserId: null, authorLabel: 'Deleted user', authorDeletedAt: now }).where(eq(groupFiles.authorUserId, account.id)),
      db.update(groupEvents).set({
        hostUserId: null,
        hostLabel: 'Deleted user',
        hostDeletedAt: now,
        state: 'cancelled',
        updatedAt: now,
      }).where(and(eq(groupEvents.hostUserId, account.id), gt(groupEvents.startsAt, now))),
      db.update(groupEvents).set({ hostUserId: null, hostLabel: 'Deleted user', hostDeletedAt: now, updatedAt: now })
        .where(and(eq(groupEvents.hostUserId, account.id), lte(groupEvents.startsAt, now))),
      db.delete(groupEventRsvps).where(eq(groupEventRsvps.userId, account.id)),
      db.delete(groupInvitations).where(or(eq(groupInvitations.invitedByUserId, account.id), eq(groupInvitations.acceptedByUserId, account.id))),
      db.delete(groupMembers).where(eq(groupMembers.userId, account.id)),
    );
  }
  // This batch is the synchronous authorization fence; any failed statement
  // rolls the event, job, account state, registry, session, and feed changes back.
  await runBatch(db, statements);
  return (await db.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.clerkUserId, input.clerkUserId)).limit(1))[0];
}

export async function processAccountDeletionJobs(
  db: Db,
  env: Pick<Cloudflare.Env, 'LEARNER_AGENT'>,
  options: { now?: number; limit?: number } = {},
): Promise<{ processed: number; failed: number }> {
  const now = options.now ?? Date.now();
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const due = await db.select().from(accountDeletionJobs)
    .where(and(eq(accountDeletionJobs.state, 'pending'), lte(accountDeletionJobs.availableAt, now)))
    .limit(limit);
  let processed = 0;
  let failed = 0;
  for (const job of due) {
    try {
      const account = job.userId
        ? (await db.select({ id: users.id, state: users.accountState }).from(users).where(eq(users.id, job.userId)).limit(1))[0]
        : (await db.select({ id: users.id, state: users.accountState }).from(users).where(eq(users.clerkUserId, job.clerkUserId)).limit(1))[0];
      if (account) {
        const objectName = learnerRuntimeObjectName(account.id);
        await runBatch(db, [
          db.update(users).set({ accountState: 'deleting' })
            .where(and(eq(users.id, account.id), eq(users.accountState, 'active'))),
          db.insert(learnerRuntimeRegistry).values({
            userId: account.id, objectName, state: 'deleting', deletionEventId: job.eventId, deletedAt: now, updatedAt: now,
          }).onConflictDoNothing(),
          db.update(learnerRuntimeRegistry).set({
            state: 'deleting', deletionEventId: job.eventId, deletedAt: now, updatedAt: now,
          }).where(and(eq(learnerRuntimeRegistry.userId, account.id), eq(learnerRuntimeRegistry.state, 'active'))),
        ]);
        const stub = env.LEARNER_AGENT.getByName(objectName) as unknown as Pick<LearnerAgentStub, 'markAccountDeleted'>;
        await stub.markAccountDeleted({ eventId: job.eventId, deletedAt: now });
        await runBatch(db, [
          db.update(users).set({ accountState: 'deleted', deletedAt: now }).where(eq(users.id, account.id)),
          db.update(learnerRuntimeRegistry).set({ state: 'deleted', deletedAt: now, updatedAt: now }).where(eq(learnerRuntimeRegistry.userId, account.id)),
          db.update(accountDeletionJobs).set({ state: 'done', userId: account.id, updatedAt: now }).where(eq(accountDeletionJobs.clerkUserId, job.clerkUserId)),
        ]);
      } else {
        await db.update(accountDeletionJobs).set({ state: 'done', userId: null, updatedAt: now }).where(eq(accountDeletionJobs.clerkUserId, job.clerkUserId));
      }
      processed += 1;
    } catch {
      const attemptCount = job.attemptCount + 1;
      await db.update(accountDeletionJobs).set({
        attemptCount,
        availableAt: now + Math.min(3_600_000, 1_000 * 2 ** Math.min(attemptCount, 11)),
        updatedAt: now,
      }).where(eq(accountDeletionJobs.clerkUserId, job.clerkUserId));
      failed += 1;
    }
  }
  return { processed, failed };
}
