import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { groupFiles } from '../../db/schema';
import {
  MAX_GROUP_FILE_BYTES,
  MAX_GROUP_FILE_COUNT,
  MAX_GROUP_STORAGE_BYTES,
} from '../schemas/groups';
import { ConflictError, NotFoundError } from './util';
import { requireGroupMembership } from './groups';
import { requireOwnedAttachment } from './attachments';

const groupFileSizeSchema = z.number().int().nonnegative().max(MAX_GROUP_FILE_BYTES, 'File exceeds the 10 MB limit');

function safeKeyName(filename: string): string {
  return filename.toWellFormed().replace(/[^\w.\-]/g, '_').slice(0, 160) || 'download';
}

type GroupFileView = typeof groupFiles.$inferSelect & { canDelete?: boolean };

export function publicGroupFile(file: GroupFileView) {
  const { authorUserId: _authorUserId, authorDeletedAt, r2Key: _r2Key, canDelete = false, ...view } = file;
  return { ...view, authorDeleted: authorDeletedAt !== null, canDelete };
}

async function removePending(db: Db, bucket: R2Bucket, id: string, key: string) {
  try {
    await bucket.delete(key);
    await db.delete(groupFiles).where(and(eq(groupFiles.id, id), eq(groupFiles.state, 'pending')));
  } catch {
    // The pending row remains a durable repair record if cleanup is unavailable.
  }
}

async function reserveGroupFile(
  db: Db,
  userId: string,
  groupId: string,
  input: { filename: string; contentType: string | null; size: number; authorLabel: string },
) {
  groupFileSizeSchema.parse(input.size);
  const id = crypto.randomUUID();
  const key = `groups/${groupId}/${id}-${safeKeyName(input.filename)}`;
  const now = Date.now();
  const reserved = await db.run(sql`
    INSERT INTO group_files(id,group_id,author_user_id,author_label,r2_key,filename,content_type,size_bytes,state,created_at,updated_at)
    SELECT ${id},${groupId},${userId},${input.authorLabel},${key},${input.filename},${input.contentType},${input.size},'pending',${now},${now}
    WHERE EXISTS(
      SELECT 1 FROM group_members gm INNER JOIN groups g ON g.id=gm.group_id INNER JOIN users u ON u.id=gm.user_id
      WHERE gm.group_id=${groupId} AND gm.user_id=${userId} AND g.state='active' AND g.owner_user_id IS NOT NULL AND u.account_state='active'
    )
    AND (SELECT COUNT(*) FROM group_files WHERE group_id=${groupId}) < ${MAX_GROUP_FILE_COUNT}
    AND (SELECT COALESCE(SUM(size_bytes),0) FROM group_files WHERE group_id=${groupId}) + ${input.size} <= ${MAX_GROUP_STORAGE_BYTES}
  `);
  if (reserved.meta.changes !== 1) {
    await requireGroupMembership(db, userId, groupId, true);
    throw new ConflictError('Group file storage limit reached');
  }
  return { id, key };
}

async function finalizeGroupFile(db: Db, bucket: R2Bucket, userId: string, groupId: string, id: string, key: string) {
  try {
    const finalized = await db.run(sql`
      UPDATE group_files SET state='ready',updated_at=${Date.now()}
      WHERE id=${id} AND state='pending'
      AND EXISTS(
        SELECT 1 FROM group_members gm INNER JOIN groups g ON g.id=gm.group_id INNER JOIN users u ON u.id=gm.user_id
        WHERE gm.group_id=${groupId} AND gm.user_id=${userId} AND g.state='active' AND g.owner_user_id IS NOT NULL AND u.account_state='active'
      )
    `);
    if (finalized.meta.changes !== 1) throw new NotFoundError('Group');
    return (await db.select().from(groupFiles).where(eq(groupFiles.id, id)).limit(1))[0]!;
  } catch (error) {
    await removePending(db, bucket, id, key);
    throw error;
  }
}

export async function createGroupFile(db: Db, bucket: R2Bucket, userId: string, groupId: string, file: File) {
  const member = await requireGroupMembership(db, userId, groupId, true);
  const label = member.name?.trim().slice(0, 100) || 'Member';
  const { id, key } = await reserveGroupFile(db, userId, groupId, { filename: file.name, contentType: file.type || null, size: file.size, authorLabel: label });

  try {
    await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  } catch (error) {
    await removePending(db, bucket, id, key);
    throw error;
  }

  return { ...await finalizeGroupFile(db, bucket, userId, groupId, id, key), canDelete: true };
}

export async function copyAttachmentToGroup(db: Db, bucket: R2Bucket, userId: string, groupId: string, attachmentId: string) {
  const member = await requireGroupMembership(db, userId, groupId, true);
  const source = await requireOwnedAttachment(db, userId, attachmentId);
  if (source.state !== 'ready') throw new NotFoundError('Attachment');
  const object = await bucket.get(source.r2Key);
  if (!object) throw new NotFoundError('Attachment object');
  groupFileSizeSchema.parse(object.size);
  await requireOwnedAttachment(db, userId, attachmentId);
  const label = member.name?.trim().slice(0, 100) || 'Member';
  const { id, key } = await reserveGroupFile(db, userId, groupId, {
    filename: source.filename,
    contentType: source.contentType,
    size: object.size,
    authorLabel: label,
  });
  try {
    await bucket.put(key, object.body, { httpMetadata: { contentType: source.contentType || 'application/octet-stream' } });
  } catch (error) {
    await removePending(db, bucket, id, key);
    throw error;
  }
  return { ...await finalizeGroupFile(db, bucket, userId, groupId, id, key), canDelete: true };
}

export async function getGroupFileObject(db: Db, bucket: R2Bucket, userId: string, groupId: string, fileId: string) {
  await requireGroupMembership(db, userId, groupId);
  const file = (await db.select().from(groupFiles).where(and(eq(groupFiles.id, fileId), eq(groupFiles.groupId, groupId), eq(groupFiles.state, 'ready'))).limit(1))[0];
  if (!file) throw new NotFoundError('Group file');
  const object = await bucket.get(file.r2Key);
  if (!object) throw new NotFoundError('Group file object');
  await requireGroupMembership(db, userId, groupId);
  const current = (await db.select({ id: groupFiles.id }).from(groupFiles).where(and(eq(groupFiles.id, fileId), eq(groupFiles.groupId, groupId), eq(groupFiles.state, 'ready'))).limit(1))[0];
  if (!current) throw new NotFoundError('Group file');
  return { file, object };
}

export async function listGroupFiles(db: Db, userId: string, groupId: string) {
  const member = await requireGroupMembership(db, userId, groupId);
  const rows = await db.select().from(groupFiles).where(and(eq(groupFiles.groupId, groupId), eq(groupFiles.state, 'ready')));
  const writable = member.group.state === 'active' && member.group.ownerUserId !== null;
  return rows.map((file) => ({
    ...file,
    canDelete: writable && (member.role === 'owner' || file.authorUserId === userId),
  }));
}

export async function deleteGroupFile(db: Db, bucket: R2Bucket, userId: string, groupId: string, fileId: string) {
  const member = await requireGroupMembership(db, userId, groupId, true);
  const file = (await db.select().from(groupFiles).where(and(eq(groupFiles.id, fileId), eq(groupFiles.groupId, groupId), eq(groupFiles.state, 'ready'))).limit(1))[0];
  if (!file || (member.role !== 'owner' && file.authorUserId !== userId)) throw new NotFoundError('Group file');
  const marked = await db.run(sql`
    UPDATE group_files SET state='deleting',updated_at=${Date.now()}
    WHERE id=${fileId} AND group_id=${groupId} AND state='ready'
    AND (${member.role === 'owner'} OR author_user_id=${userId})
    AND EXISTS(
      SELECT 1 FROM group_members gm INNER JOIN groups g ON g.id=gm.group_id INNER JOIN users u ON u.id=gm.user_id
      WHERE gm.group_id=${groupId} AND gm.user_id=${userId} AND g.state='active' AND g.owner_user_id IS NOT NULL AND u.account_state='active'
    )
  `);
  if (marked.meta.changes !== 1) throw new NotFoundError('Group file');
  await requireGroupMembership(db, userId, groupId, true);
  await bucket.delete(file.r2Key);
  await db.delete(groupFiles).where(and(eq(groupFiles.id, fileId), eq(groupFiles.groupId, groupId), eq(groupFiles.state, 'deleting')));
}

export async function reconcileGroupFiles(
  db: Db,
  bucket: R2Bucket,
  options: { now?: number; staleMs?: number; limit?: number } = {},
) {
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? 5 * 60_000;
  const rows = await db.select().from(groupFiles)
    .where(and(inArray(groupFiles.state, ['pending', 'deleting']), lte(groupFiles.updatedAt, now - staleMs)))
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 100));
  let repaired = 0;
  let retained = 0;
  for (const file of rows) {
    try {
      if (file.state === 'pending') {
        await bucket.delete(file.r2Key);
        await db.delete(groupFiles).where(and(eq(groupFiles.id, file.id), eq(groupFiles.state, 'pending')));
      } else if (await bucket.head(file.r2Key)) {
        // The API removes the row immediately after a successful R2 delete.
        // A stale deleting row with bytes still present records a failed or
        // interrupted provider call, so restore it for an explicit retry.
        await db.update(groupFiles).set({ state: 'ready', updatedAt: now })
          .where(and(eq(groupFiles.id, file.id), eq(groupFiles.state, 'deleting')));
      } else {
        await db.delete(groupFiles).where(and(eq(groupFiles.id, file.id), eq(groupFiles.state, 'deleting')));
      }
      repaired += 1;
    } catch {
      retained += 1;
    }
  }
  return { scanned: rows.length, repaired, retained };
}
