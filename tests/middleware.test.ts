import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { ClerkIdentityConflictError, resolveLocalUser } from '../src/lib/auth/local-user';

const db = getDb(env.DB);

beforeEach(async () => {
  await db.delete(users);
});

describe('Clerk local learner bridge', () => {
  it('provisions a new local learner and returns it on subsequent requests', async () => {
    const identity = {
      id: 'user_clerk_new',
      primaryEmailAddress: 'new@example.test',
      firstName: 'New',
      lastName: 'Learner',
    };

    const first = await resolveLocalUser(db, identity);
    const second = await resolveLocalUser(db, identity);

    expect(first.user.id).toBe(second.user.id);
    expect(first.user.clerkUserId).toBe('user_clerk_new');
    expect(first.user.email).toBe('new@example.test');
    expect(first.user.name).toBe('New Learner');
    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
  });

  it('binds an imported Clerk external id to its existing local learner', async () => {
    await db.insert(users).values({
      id: 'legacy-user-id',
      email: 'legacy@example.test',
      passwordHash: 'pbkdf2$100000$00$00',
    });

    const resolution = await resolveLocalUser(db, {
      id: 'user_clerk_imported',
      externalId: 'legacy-user-id',
      primaryEmailAddress: 'changed@example.test',
    });

    expect(resolution.user.id).toBe('legacy-user-id');
    expect(resolution.user.clerkUserId).toBe('user_clerk_imported');
    expect(resolution.user.email).toBe('legacy@example.test');
    expect(resolution.wasCreated).toBe(false);
  });

  it('refuses to relink a local learner to another Clerk account', async () => {
    await db.insert(users).values({
      id: 'already-linked',
      clerkUserId: 'user_clerk_original',
      email: 'linked@example.test',
      passwordHash: 'pbkdf2$100000$00$00',
    });

    await expect(
      resolveLocalUser(db, { id: 'user_clerk_other', externalId: 'already-linked' }),
    ).rejects.toBeInstanceOf(ClerkIdentityConflictError);
  });
});
