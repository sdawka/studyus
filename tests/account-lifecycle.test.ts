import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/db/client';
import { accountDeletionEvents, accountDeletionJobs, learnerRuntimeRegistry, users } from '../src/db/schema';
import { resolveLocalUser } from '../src/lib/auth/local-user';
import {
  AccountInactiveError,
  enqueueAccountDeletion,
  processAccountDeletionJobs,
} from '../src/lib/services/accountLifecycle';
import { learnerAgentObjectName, type LearnerAgentStub } from '../src/lib/runtime/learnerAgent';

const db = getDb(env.DB);

beforeEach(async () => {
  await db.delete(accountDeletionJobs);
  await db.delete(learnerRuntimeRegistry);
  await db.delete(users);
});

describe('retained account lifecycle', () => {
  it('creates an idempotent active runtime registry entry during provisioning', async () => {
    const first = await resolveLocalUser(db, { id: 'clerk-new', primaryEmailAddress: 'new@test.local' });
    await resolveLocalUser(db, { id: 'clerk-new', primaryEmailAddress: 'new@test.local' });
    const rows = await db.select().from(learnerRuntimeRegistry).where(eq(learnerRuntimeRegistry.userId, first.user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ objectName: learnerAgentObjectName(first.user.id), state: 'active' });
  });

  it('fences deletion received before provisioning and never recreates that Clerk identity', async () => {
    await enqueueAccountDeletion(db, { eventId: 'evt-before', clerkUserId: 'clerk-deleted' }, 1000);
    await expect(resolveLocalUser(db, { id: 'clerk-deleted', primaryEmailAddress: 'same@test.local' })).rejects.toBeInstanceOf(AccountInactiveError);
    expect(await db.select().from(users)).toEqual([]);
  });

  it('rolls back the complete authorization fence when any batched statement fails, then repairs on replay', async () => {
    const { user } = await resolveLocalUser(db, { id: 'clerk-atomic', primaryEmailAddress: 'atomic@test.local' });
    await env.DB.exec("CREATE TRIGGER fail_deletion_job BEFORE INSERT ON account_deletion_jobs BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    try {
      await expect(enqueueAccountDeletion(db, { eventId: 'evt-atomic', clerkUserId: 'clerk-atomic' }, 1500)).rejects.toThrow();
    } finally {
      await env.DB.exec('DROP TRIGGER fail_deletion_job');
    }
    expect((await db.select().from(users).where(eq(users.id, user.id)))[0].accountState).toBe('active');
    expect(await db.select().from(accountDeletionEvents).where(eq(accountDeletionEvents.eventId, 'evt-atomic'))).toEqual([]);
    expect(await db.select().from(accountDeletionJobs).where(eq(accountDeletionJobs.clerkUserId, 'clerk-atomic'))).toEqual([]);

    await enqueueAccountDeletion(db, { eventId: 'evt-atomic', clerkUserId: 'clerk-atomic' }, 1600);
    expect((await db.select().from(users).where(eq(users.id, user.id)))[0].accountState).toBe('deleting');
  });

  it('tombstones D1 and the existing DO while retaining runtime data', async () => {
    const { user } = await resolveLocalUser(db, { id: 'clerk-existing', primaryEmailAddress: 'old@test.local' });
    const raw = env.LEARNER_AGENT.getByName(learnerAgentObjectName(user.id)) as unknown as DurableObjectStub;
    const learner = raw as unknown as LearnerAgentStub;
    await learner.initialize(user.id);
    await learner.createConversation({ id: 'kept', mode: 'socratic' });

    await enqueueAccountDeletion(db, { eventId: 'evt-delete', clerkUserId: 'clerk-existing' }, 2000);
    await processAccountDeletionJobs(db, env, { now: 2000 });

    const row = (await db.select().from(users).where(eq(users.id, user.id)))[0];
    expect(row.accountState).toBe('deleted');
    const fenced = await learner.fetch(new Request('https://learner-agent.internal/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'kept', turnId: 'late', systemPrompt: 'x'.repeat(24), messageCap: 10 }),
    }));
    expect(fenced.status).toBe(410);
    await runInDurableObject(raw, (_instance, state) => {
      const kept = state.storage.sql.exec<{ id: string }>('SELECT id FROM conversations WHERE id = ?', 'kept').toArray();
      expect(kept).toHaveLength(1);
    });
  });

  it('keeps replay ordering monotonic and rejects external-id relinking after deletion', async () => {
    const { user } = await resolveLocalUser(db, { id: 'clerk-original', primaryEmailAddress: 'old@test.local' });
    await enqueueAccountDeletion(db, { eventId: 'evt-first', clerkUserId: 'clerk-original' }, 3000);
    await processAccountDeletionJobs(db, env, { now: 3000 });
    await enqueueAccountDeletion(db, { eventId: 'evt-late', clerkUserId: 'clerk-original' }, 4000);
    await expect(resolveLocalUser(db, { id: 'clerk-new', externalId: user.id, primaryEmailAddress: 'old@test.local' })).rejects.toBeInstanceOf(AccountInactiveError);
    const jobs = await db.select().from(accountDeletionJobs);
    expect(jobs[0]).toMatchObject({ eventId: 'evt-first', state: 'done' });
    const retained = (await db.select().from(users).where(eq(users.id, user.id)))[0];
    const registry = (await db.select().from(learnerRuntimeRegistry).where(eq(learnerRuntimeRegistry.userId, user.id)))[0];
    expect(retained.accountState).toBe('deleted');
    expect(registry).toMatchObject({ state: 'deleted', deletionEventId: 'evt-first' });
  });

  it('allows a distinct Clerk account to sign up with the retained row email', async () => {
    const first = await resolveLocalUser(db, { id: 'clerk-old-email', primaryEmailAddress: 'reuse@test.local' });
    await enqueueAccountDeletion(db, { eventId: 'evt-old-email', clerkUserId: 'clerk-old-email' }, 5000);
    await processAccountDeletionJobs(db, env, { now: 5000 });

    const replacement = await resolveLocalUser(db, { id: 'clerk-new-email', primaryEmailAddress: 'reuse@test.local' });
    expect(replacement.wasCreated).toBe(true);
    expect(replacement.user.id).not.toBe(first.user.id);
    expect(replacement.user.accountState).toBe('active');
  });
});
