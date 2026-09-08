import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { courses, groupFiles, groupMembers, groups, users } from '../src/db/schema';
import { createGroup } from '../src/lib/services/groups';
import { copyAttachmentToGroup, createGroupFile, deleteGroupFile, getGroupFileObject, publicGroupFile, reconcileGroupFiles } from '../src/lib/services/groupFiles';
import { enqueueAccountDeletion } from '../src/lib/services/accountLifecycle';
import { createAttachment, deleteAttachment } from '../src/lib/services/attachments';

const db = getDb(env.DB);

async function user() {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email: `${id}@test.local`, passwordHash: 'x' });
  return id;
}

beforeEach(async () => {
  await db.delete(groupFiles);
  await db.delete(groupMembers);
  await db.delete(groups);
});

describe('group-owned files', () => {
  it('never exposes the private R2 key or author user id in browser metadata', () => {
    const view = publicGroupFile({ id: 'f', groupId: 'g', authorUserId: 'u', authorLabel: 'Ada', authorDeletedAt: null, r2Key: 'groups/g/private', filename: 'file.txt', contentType: 'text/plain', sizeBytes: 4, state: 'ready', createdAt: 1, updatedAt: 1 });
    expect(view).not.toHaveProperty('r2Key');
    expect(view).not.toHaveProperty('authorUserId');
  });

  it('serves files only to current members and preserves a group-owned R2 key', async () => {
    const ownerId = await user();
    const outsiderId = await user();
    const group = await createGroup(db, ownerId, { name: 'Files' });
    const uploaded = await createGroupFile(db, env.UPLOADS, ownerId, group.id, new File(['private'], 'notes.txt', { type: 'text/plain' }));
    expect(uploaded.r2Key.startsWith(`groups/${group.id}/`)).toBe(true);
    await expect(getGroupFileObject(db, env.UPLOADS, outsiderId, group.id, uploaded.id)).rejects.toThrow('not found');
    const loaded = await getGroupFileObject(db, env.UPLOADS, ownerId, group.id, uploaded.id);
    expect(await loaded.object.text()).toBe('private');
  });

  it('copies an owned private attachment into an independent group R2 object', async () => {
    const ownerId = await user();
    const outsiderId = await user();
    const courseId = crypto.randomUUID();
    await db.insert(courses).values({ id: courseId, userId: ownerId, code: 'COPY', slug: `copy-${courseId}`, title: 'Copy source' });
    const source = await createAttachment(db, env.UPLOADS, ownerId, courseId, new File(['shared copy'], 'source.txt', { type: 'text/plain' }));
    const group = await createGroup(db, ownerId, { name: 'Copies' });

    await expect(copyAttachmentToGroup(db, env.UPLOADS, outsiderId, group.id, source.id)).rejects.toThrow('not found');
    expect(await db.select().from(groupFiles).where(eq(groupFiles.groupId, group.id))).toEqual([]);
    const copied = await copyAttachmentToGroup(db, env.UPLOADS, ownerId, group.id, source.id);
    expect(copied.r2Key).not.toBe(source.r2Key);
    expect(copied.r2Key.startsWith(`groups/${group.id}/`)).toBe(true);
    await deleteAttachment(db, env.UPLOADS, ownerId, source.id);
    expect(await env.UPLOADS.get(source.r2Key)).toBeNull();
    expect(await (await env.UPLOADS.get(copied.r2Key))?.text()).toBe('shared copy');
  });

  it('does not release an R2 read after membership is removed in flight', async () => {
    const ownerId = await user();
    const group = await createGroup(db, ownerId, { name: 'Fence' });
    const uploaded = await createGroupFile(db, env.UPLOADS, ownerId, group.id, new File(['retained'], 'retained.txt'));
    const delayed = {
      get: async (key: string) => {
        const object = await env.UPLOADS.get(key);
        await db.delete(groupMembers).where(eq(groupMembers.userId, ownerId));
        return object;
      },
    } as unknown as R2Bucket;
    await expect(getGroupFileObject(db, delayed, ownerId, group.id, uploaded.id)).rejects.toThrow('not found');
    expect(await env.UPLOADS.get(uploaded.r2Key)).not.toBeNull();
  });

  it('cleans R2 and the reservation when final D1 publication fails', async () => {
    const ownerId = await user();
    const group = await createGroup(db, ownerId, { name: 'Cleanup' });
    await env.DB.exec("CREATE TRIGGER reject_group_file_publish BEFORE UPDATE OF state ON group_files WHEN NEW.state = 'ready' BEGIN SELECT RAISE(ABORT, 'synthetic publish failure'); END;");
    try {
      await expect(createGroupFile(db, env.UPLOADS, ownerId, group.id, new File(['no'], 'failed.txt'))).rejects.toThrow();
      expect(await db.select().from(groupFiles).where(eq(groupFiles.groupId, group.id))).toEqual([]);
      expect((await env.UPLOADS.list({ prefix: `groups/${group.id}/` })).objects).toEqual([]);
    } finally {
      await env.DB.exec('DROP TRIGGER reject_group_file_publish');
    }
  });

  it('does not publish an upload whose owner is fenced during R2 storage', async () => {
    const ownerId = await user();
    const clerkUserId = `clerk-${ownerId}`;
    await db.update(users).set({ clerkUserId }).where(eq(users.id, ownerId));
    const group = await createGroup(db, ownerId, { name: 'Upload race' });
    const delayed = {
      put: async (key: string, value: ReadableStream, options: R2PutOptions) => {
        await env.UPLOADS.put(key, value, options);
        await enqueueAccountDeletion(db, { eventId: `evt-${ownerId}`, clerkUserId }, Date.now());
      },
      delete: env.UPLOADS.delete.bind(env.UPLOADS),
    } as unknown as R2Bucket;

    await expect(createGroupFile(db, delayed, ownerId, group.id, new File(['late'], 'late.txt'))).rejects.toThrow('not found');
    expect(await db.select().from(groupFiles).where(eq(groupFiles.groupId, group.id))).toEqual([]);
    expect((await env.UPLOADS.list({ prefix: `groups/${group.id}/` })).objects).toEqual([]);
  });

  it('allows only the author or owner to delete a shared file', async () => {
    const ownerId = await user();
    const memberId = await user();
    const otherId = await user();
    const group = await createGroup(db, ownerId, { name: 'Permissions' });
    await db.insert(groupMembers).values([
      { groupId: group.id, userId: memberId, role: 'member', joinedAt: Date.now() },
      { groupId: group.id, userId: otherId, role: 'member', joinedAt: Date.now() },
    ]);
    const uploaded = await createGroupFile(db, env.UPLOADS, memberId, group.id, new File(['x'], 'member.txt'));
    await expect(deleteGroupFile(db, env.UPLOADS, otherId, group.id, uploaded.id)).rejects.toThrow('not found');
    await deleteGroupFile(db, env.UPLOADS, ownerId, group.id, uploaded.id);
    expect(await env.UPLOADS.get(uploaded.r2Key)).toBeNull();
  });

  it('discards stale unacknowledged uploads and restores failed deletion rows without deleting shared bytes', async () => {
    const ownerId = await user();
    const group = await createGroup(db, ownerId, { name: 'Repair' });
    const pendingId = crypto.randomUUID();
    const pendingKey = `groups/${group.id}/${pendingId}-pending.txt`;
    await env.UPLOADS.put(pendingKey, 'pending');
    await db.insert(groupFiles).values({ id: pendingId, groupId: group.id, authorUserId: ownerId, authorLabel: 'Member', r2Key: pendingKey, filename: 'pending.txt', sizeBytes: 7, state: 'pending', createdAt: 0, updatedAt: 0 });
    const ready = await createGroupFile(db, env.UPLOADS, ownerId, group.id, new File(['ready'], 'ready.txt'));
    await db.update(groupFiles).set({ state: 'deleting', updatedAt: 0 }).where(eq(groupFiles.id, ready.id));

    await reconcileGroupFiles(db, env.UPLOADS, { now: 1, staleMs: 0 });

    expect(await db.select().from(groupFiles).where(eq(groupFiles.id, pendingId))).toEqual([]);
    expect(await env.UPLOADS.get(pendingKey)).toBeNull();
    expect((await db.select().from(groupFiles).where(eq(groupFiles.id, ready.id)))[0]?.state).toBe('ready');
    expect(await env.UPLOADS.get(ready.r2Key)).not.toBeNull();
  });
});
