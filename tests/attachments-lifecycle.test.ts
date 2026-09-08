import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { attachments, courses, users } from '../src/db/schema';
import { createAttachment, deleteAttachment, getAttachmentObject, reconcileAttachments } from '../src/lib/services/attachments';

const db = getDb(env.DB);
const ACCOUNT_ATTACHMENT_COUNT = 100;
const ACCOUNT_ATTACHMENT_BYTES = 250 * 1024 * 1024;

let userId: string;
let courseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'UPLOAD 101', slug: `upload-${courseId}`, title: 'Upload course' });
});

function file(content: string, name = 'upload.txt'): File {
  return new File([content], name, { type: 'text/plain' });
}

describe('attachment quota reservations', () => {
  it('admits only one concurrent upload into the final account slot', async () => {
    for (let index = 0; index < ACCOUNT_ATTACHMENT_COUNT - 1; index += 1) {
      await db.insert(attachments).values({
        id: crypto.randomUUID(),
        userId,
        courseId,
        r2Key: `${userId}/${courseId}/seed-${index}`,
        filename: `seed-${index}.txt`,
        contentType: 'text/plain',
        sizeBytes: 1,
        state: 'ready' as const,
        updatedAt: Date.now(),
      });
    }

    const results = await Promise.allSettled([
      createAttachment(db, env.UPLOADS, userId, courseId, file('first', 'first.txt')),
      createAttachment(db, env.UPLOADS, userId, courseId, file('second', 'second.txt')),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await db.select().from(attachments).where(eq(attachments.userId, userId))).toHaveLength(ACCOUNT_ATTACHMENT_COUNT);
  });

  it('counts stored bytes before accepting another upload', async () => {
    await db.insert(attachments).values({
      id: crypto.randomUUID(),
      userId,
      courseId,
      r2Key: `${userId}/${courseId}/at-byte-cap`,
      filename: 'at-byte-cap.txt',
      contentType: 'text/plain',
      sizeBytes: ACCOUNT_ATTACHMENT_BYTES,
      state: 'ready',
      updatedAt: Date.now(),
    });

    await expect(createAttachment(db, env.UPLOADS, userId, courseId, file('x'))).rejects.toThrow('storage limit');
    expect(await db.select().from(attachments).where(eq(attachments.userId, userId))).toHaveLength(1);
  });
});

describe('attachment lifecycle recovery', () => {
  it('does not release an R2 read completed after the account fence', async () => {
    const uploaded = await createAttachment(db, env.UPLOADS, userId, courseId, file('retained'));
    const delayedBucket = { get: async (key: string) => {
      const object = await env.UPLOADS.get(key);
      await db.update(users).set({ accountState: 'deleting' }).where(eq(users.id, userId));
      return object;
    } } as unknown as R2Bucket;
    await expect(getAttachmentObject(db, delayedBucket, userId, uploaded.id)).rejects.toThrow('Attachment not found');
    expect(await env.UPLOADS.get(uploaded.r2Key)).not.toBeNull();
  });
  it('finishes a stale admitted deletion after the account is subsequently fenced', async () => {
    const uploaded = await createAttachment(db, env.UPLOADS, userId, courseId, file('admitted deletion'));
    await db.update(attachments).set({ state: 'deleting', updatedAt: 0 }).where(eq(attachments.id, uploaded.id));
    await db.update(users).set({ accountState: 'deleting' }).where(eq(users.id, userId));
    await reconcileAttachments(db, env.UPLOADS, { now: 1, staleMs: 0 });
    expect(await env.UPLOADS.get(uploaded.r2Key)).toBeNull();
    expect(await db.select().from(attachments).where(eq(attachments.id, uploaded.id))).toEqual([]);
  });
  it('finishes an admitted deletion when the account fence lands during the R2 operation', async () => {
    const uploaded = await createAttachment(db, env.UPLOADS, userId, courseId, file('delete in flight'));
    const delayedBucket = {
      delete: async (key: string) => {
        await db.update(users).set({ accountState: 'deleting' }).where(eq(users.id, userId));
        await env.UPLOADS.delete(key);
      },
    } as unknown as R2Bucket;

    await expect(deleteAttachment(db, delayedBucket, userId, uploaded.id)).resolves.toBeUndefined();
    expect(await env.UPLOADS.get(uploaded.r2Key)).toBeNull();
    expect(await db.select().from(attachments).where(eq(attachments.id, uploaded.id))).toEqual([]);
  });
  it('does not leave an upload after publication fails in D1', async () => {
    await env.DB.exec("CREATE TRIGGER reject_attachment_publish BEFORE UPDATE OF state ON attachments WHEN NEW.state = 'ready' BEGIN SELECT RAISE(ABORT, 'synthetic publish failure'); END;");
    try {
      await expect(createAttachment(db, env.UPLOADS, userId, courseId, file('not acknowledged'))).rejects.toThrow();
      expect(await db.select().from(attachments).where(eq(attachments.userId, userId))).toEqual([]);
      expect((await env.UPLOADS.list({ prefix: userId + '/' })).objects).toEqual([]);
    } finally {
      await env.DB.exec('DROP TRIGGER reject_attachment_publish');
    }
  });
  it('denies retained ready attachments after account deletion', async () => {
    const uploaded = await createAttachment(db, env.UPLOADS, userId, courseId, file('retained private'));
    await db.update(users).set({ accountState: 'deleted' }).where(eq(users.id, userId));
    await expect(getAttachmentObject(db, env.UPLOADS, userId, uploaded.id)).rejects.toThrow('Attachment not found');
    let deleteCalls = 0;
    const observedBucket = { delete: async () => { deleteCalls += 1; } } as unknown as R2Bucket;
    await expect(deleteAttachment(db, observedBucket, userId, uploaded.id)).rejects.toThrow('Attachment not found');
    expect(deleteCalls).toBe(0);
    expect(await env.UPLOADS.get(uploaded.r2Key)).not.toBeNull();
  });
  it('discards stale uncommitted uploads instead of publishing a failed request later', async () => {
    const pendingId = crypto.randomUUID();
    const r2Key = `${userId}/${courseId}/${pendingId}`;
    await env.UPLOADS.put(r2Key, 'uncommitted');
    await db.insert(attachments).values({ id: pendingId, userId, courseId, r2Key, filename: 'pending.txt', sizeBytes: 11, state: 'pending', updatedAt: 0 });
    await reconcileAttachments(db, env.UPLOADS, { now: 1, staleMs: 0 });
    expect(await db.select().from(attachments).where(eq(attachments.id, pendingId))).toEqual([]);
    expect(await env.UPLOADS.get(r2Key)).toBeNull();
  });

  it('removes a failed upload reservation so the learner can retry', async () => {
    const failingBucket = {
      put: async () => { throw new Error('R2 unavailable'); },
      delete: env.UPLOADS.delete.bind(env.UPLOADS),
    } as unknown as R2Bucket;

    await expect(createAttachment(db, failingBucket, userId, courseId, file('retry me'))).rejects.toThrow('R2 unavailable');
    expect(await db.select().from(attachments).where(eq(attachments.userId, userId))).toEqual([]);

    const retried = await createAttachment(db, env.UPLOADS, userId, courseId, file('retry me'));
    expect(retried.state).toBe('ready');
    expect(await env.UPLOADS.get(retried.r2Key)).not.toBeNull();
  });

  it('retains a deleting row after an R2 failure and lets reconciliation finish it', async () => {
    const uploaded = await createAttachment(db, env.UPLOADS, userId, courseId, file('remove me'));
    const failingBucket = { delete: async () => { throw new Error('R2 delete unavailable'); } } as unknown as R2Bucket;

    await expect(deleteAttachment(db, failingBucket, userId, uploaded.id)).rejects.toThrow('R2 delete unavailable');
    expect((await db.select().from(attachments).where(eq(attachments.id, uploaded.id)))[0]?.state).toBe('deleting');

    expect(await reconcileAttachments(db, env.UPLOADS, { staleMs: 0 })).toMatchObject({ scanned: 1, repaired: 1, retained: 0 });
    expect(await db.select().from(attachments).where(eq(attachments.id, uploaded.id))).toEqual([]);
    expect(await env.UPLOADS.get(uploaded.r2Key)).toBeNull();
  });

  it('does not expose a foreign attachment or accept a foreign course upload', async () => {
    const foreignUserId = crypto.randomUUID();
    await db.insert(users).values({ id: foreignUserId, email: `${foreignUserId}@test.local`, passwordHash: 'x' });
    const uploaded = await createAttachment(db, env.UPLOADS, userId, courseId, file('private'));

    await expect(getAttachmentObject(db, env.UPLOADS, foreignUserId, uploaded.id)).rejects.toThrow('Attachment not found');
    await expect(createAttachment(db, env.UPLOADS, foreignUserId, courseId, file('foreign'))).rejects.toThrow('Course not found');
    expect(await env.UPLOADS.get(uploaded.r2Key)).not.toBeNull();
  });

  it('deletes a pending object for an inactive owner rather than marking it ready', async () => {
    const pendingId = crypto.randomUUID();
    const r2Key = `${userId}/${courseId}/${pendingId}-pending.txt`;
    await env.UPLOADS.put(r2Key, 'pending bytes');
    await db.insert(attachments).values({
      id: pendingId,
      userId,
      courseId,
      r2Key,
      filename: 'pending.txt',
      contentType: 'text/plain',
      sizeBytes: 13,
      state: 'pending',
      updatedAt: 0,
    });
    await db.update(users).set({ accountState: 'deleting' }).where(eq(users.id, userId));

    await expect(reconcileAttachments(db, env.UPLOADS, { now: 1, staleMs: 0 })).resolves.toMatchObject({ repaired: 1 });
    expect(await db.select().from(attachments).where(eq(attachments.id, pendingId))).toEqual([]);
    expect(await env.UPLOADS.get(r2Key)).toBeNull();
  });
});
