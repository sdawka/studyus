import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import { AccountInactiveError, assertClerkIdentityMayResolve, ensureActiveRuntimeRegistry } from '../services/accountLifecycle';

export { AccountInactiveError } from '../services/accountLifecycle';

/** The small Clerk profile subset needed to establish a local learner row. */
export interface ClerkIdentity {
  id: string;
  externalId?: string | null;
  primaryEmailAddress?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export class ClerkIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClerkIdentityConflictError';
  }
}

function displayName(identity: ClerkIdentity): string | null {
  const name = [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim();
  return name || null;
}

function fallbackEmail(clerkUserId: string): string {
  // Clerk can be configured for phone/OAuth-only onboarding. The local model
  // currently requires an email, so reserve a non-routable address instead of
  // rejecting an otherwise valid Clerk account.
  return `${clerkUserId}@clerk-user.invalid`;
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
    return { user: byClerkId[0], wasCreated: false };
  }

  if (identity.externalId) {
    const byLegacyId = await db.select().from(users).where(eq(users.id, identity.externalId)).limit(1);
    const legacyUser = byLegacyId[0];
    if (legacyUser) {
      if (legacyUser.accountState !== 'active') throw new AccountInactiveError();
      if (legacyUser.clerkUserId && legacyUser.clerkUserId !== identity.id) {
        throw new ClerkIdentityConflictError('This learner is already linked to another Clerk account.');
      }
      await ensureActiveRuntimeRegistry(db, legacyUser.id);
      const binding = await db.run(sql`
        UPDATE users SET clerk_user_id = ${identity.id}
        WHERE id = ${legacyUser.id} AND account_state = 'active'
        AND NOT EXISTS (SELECT 1 FROM account_deletion_events WHERE clerk_user_id = ${identity.id})
        AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs WHERE clerk_user_id = ${identity.id})
      `);
      if (binding.meta.changes !== 1) throw new AccountInactiveError();
      return { user: { ...legacyUser, clerkUserId: identity.id }, wasCreated: false };
    }
  }

  const id = crypto.randomUUID();
  const email = identity.primaryEmailAddress ?? fallbackEmail(identity.id);
  const name = displayName(identity);
  const createdAt = Date.now();
  const insertion = await db.run(sql`
    INSERT INTO users (id, clerk_user_id, email, password_hash, name, account_state, created_at)
    SELECT ${id}, ${identity.id}, ${email}, 'clerk-managed', ${name}, 'active', ${createdAt}
    WHERE NOT EXISTS (SELECT 1 FROM account_deletion_events WHERE clerk_user_id = ${identity.id})
    AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs WHERE clerk_user_id = ${identity.id})
  `);
  if (insertion.meta.changes !== 1) throw new AccountInactiveError();
  await ensureActiveRuntimeRegistry(db, id);

  const created = await db.select().from(users).where(eq(users.id, id)).limit(1);
  // The insert was acknowledged and id is generated locally; this narrows the
  // return type without manufacturing a partial user object.
  if (!created[0]) throw new Error('Could not provision the local learner profile.');
  return { user: created[0], wasCreated: true };
}
