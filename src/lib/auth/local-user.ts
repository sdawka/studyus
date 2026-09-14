import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, users } from '../../db/schema';
import { AccountInactiveError, assertClerkIdentityMayResolve, ensureActiveRuntimeRegistry } from '../services/accountLifecycle';
import { BOOTSTRAP_COURSE_KEY, provisionLearner, type ClerkIdentity } from '../services/learnerBootstrap';

export { AccountInactiveError } from '../services/accountLifecycle';
export type { ClerkIdentity } from '../services/learnerBootstrap';

export class ClerkIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClerkIdentityConflictError';
  }
}

/**
 * Resolves Clerk identity to the immutable local learner identity.
 *
 * Imports must set Clerk `external_id` to the legacy `users.id`. On first
 * sign-in that binding is persisted, preserving all existing D1 foreign keys.
 * A brand-new Clerk account instead receives a fresh local learner row.
 */
export async function resolveLocalUser(db: Db, identity: ClerkIdentity) {
  await assertClerkIdentityMayResolve(db, identity.id);
  const byClerkId = await db.select().from(users).where(eq(users.clerkUserId, identity.id)).limit(1);
  if (byClerkId[0]) {
    if (byClerkId[0].accountState !== 'active') throw new AccountInactiveError();
    await ensureActiveRuntimeRegistry(db, byClerkId[0].id);
    const defaultCourse = (await db.select().from(courses)
      .where(and(eq(courses.userId, byClerkId[0].id), eq(courses.bootstrapKey, BOOTSTRAP_COURSE_KEY)))
      .limit(1))[0] ?? null;
    return { user: byClerkId[0], wasCreated: false, defaultCourse };
  }

  if (identity.externalId) {
    const byLegacyId = await db.select().from(users).where(eq(users.id, identity.externalId)).limit(1);
    const legacyUser = byLegacyId[0];
    if (legacyUser) {
      if (legacyUser.accountState !== 'active') throw new AccountInactiveError();
      if (legacyUser.clerkUserId && legacyUser.clerkUserId !== identity.id) {
        throw new ClerkIdentityConflictError('This learner is already linked to another Clerk account.');
      }
      const binding = await db.run(sql`
        UPDATE users SET clerk_user_id = ${identity.id}
        WHERE id = ${legacyUser.id} AND account_state = 'active'
        AND NOT EXISTS (SELECT 1 FROM account_deletion_events WHERE clerk_user_id = ${identity.id})
        AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs WHERE clerk_user_id = ${identity.id})
      `);
      if (binding.meta.changes !== 1) throw new AccountInactiveError();
      await ensureActiveRuntimeRegistry(db, legacyUser.id);
      return { user: { ...legacyUser, clerkUserId: identity.id }, wasCreated: false, defaultCourse: null };
    }
  }

  return provisionLearner(db, identity);
}
