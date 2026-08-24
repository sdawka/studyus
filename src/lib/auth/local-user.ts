import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';

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
  const byClerkId = await db.select().from(users).where(eq(users.clerkUserId, identity.id)).limit(1);
  if (byClerkId[0]) return byClerkId[0];

  if (identity.externalId) {
    const byLegacyId = await db.select().from(users).where(eq(users.id, identity.externalId)).limit(1);
    const legacyUser = byLegacyId[0];
    if (legacyUser) {
      if (legacyUser.clerkUserId && legacyUser.clerkUserId !== identity.id) {
        throw new ClerkIdentityConflictError('This learner is already linked to another Clerk account.');
      }
      await db.update(users).set({ clerkUserId: identity.id }).where(eq(users.id, legacyUser.id));
      return { ...legacyUser, clerkUserId: identity.id };
    }
  }

  const id = crypto.randomUUID();
  const email = identity.primaryEmailAddress ?? fallbackEmail(identity.id);
  const name = displayName(identity);
  await db.insert(users).values({
    id,
    clerkUserId: identity.id,
    email,
    // The physical D1 column remains non-null to keep the migration additive.
    // Custom password verification is retired, so this value is never valid.
    passwordHash: 'clerk-managed',
    name,
  });

  const created = await db.select().from(users).where(eq(users.id, id)).limit(1);
  // The insert was acknowledged and id is generated locally; this narrows the
  // return type without manufacturing a partial user object.
  if (!created[0]) throw new Error('Could not provision the local learner profile.');
  return created[0];
}
