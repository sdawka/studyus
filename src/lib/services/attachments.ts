// R2-backed attachments. Key convention: userId/courseId/uuid-filename (or
// userId/_/uuid-filename when not course-scoped) so objects stay listable
// per-user without a separate index if R2 is ever browsed directly.
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { attachments, courses, users } from '../../db/schema';
import { MAX_ACCOUNT_ATTACHMENT_BYTES, MAX_ACCOUNT_ATTACHMENT_COUNT, MAX_ATTACHMENT_BYTES } from '../schemas/attachments';
import { ConflictError, NotFoundError } from './util';

// Reuses the same ZodError -> 400 invalid_input mapping (apiErrors.ts) every
// other schema violation in this API goes through, rather than introducing a
// bespoke error type just for this one check.
const fileSizeSchema = z
  .number()
  .max(MAX_ATTACHMENT_BYTES, `File exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`);

async function requireActiveOwnedCourse(db: Db, userId: string, courseId: string) {
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .innerJoin(users, eq(courses.userId, users.id))
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId), eq(users.accountState, 'active')))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Course');
}

export async function listAttachments(db: Db, userId: string, courseId: string) {
  await requireActiveOwnedCourse(db, userId, courseId);
  return db.select({
    id: attachments.id,
    filename: attachments.filename,
    sizeBytes: attachments.sizeBytes,
    contentType: attachments.contentType,
  })
    .from(attachments)
    .where(and(
      eq(attachments.userId, userId),
      eq(attachments.courseId, courseId),
      eq(attachments.state, 'ready'),
    ))
    .orderBy(desc(attachments.createdAt), desc(attachments.id))
    .limit(MAX_ACCOUNT_ATTACHMENT_COUNT);
}

async function removePendingAfterStorageFailure(db: Db, bucket: R2Bucket, id: string, r2Key: string) {
  try {
    await bucket.delete(r2Key);
    await db.delete(attachments).where(and(eq(attachments.id, id), eq(attachments.state, 'pending')));
  } catch {
    // Keep the pending row when cleanup itself fails so reconciliation can
    // retry instead of silently losing the durable repair record.
  }
}

export async function createAttachment(
  db: Db,
  bucket: R2Bucket,
  userId: string,
  courseId: string,
  file: File,
) {
  await requireActiveOwnedCourse(db, userId, courseId);
  // Checked against file.size (no read yet) before ever buffering the
  // upload into memory via arrayBuffer() below.
  fileSizeSchema.parse(file.size);

  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\-]/g, '_');
  const r2Key = `${userId}/${courseId}/${id}-${safeName}`;
  const now = Date.now();

  // One D1 statement reserves the exact measured payload while counting every
  // durable lifecycle state. Competing requests therefore cannot both occupy
  // the final count/byte slot between a read and a later insert.
  const reservation = await db.run(sql`
    INSERT INTO attachments (id, user_id, course_id, r2_key, filename, content_type, size_bytes, state, updated_at, created_at)
    SELECT ${id}, ${userId}, ${courseId}, ${r2Key}, ${file.name}, ${file.type || null}, ${file.size}, 'pending', ${now}, ${now}
    WHERE EXISTS (
      SELECT 1 FROM courses
      INNER JOIN users ON users.id = courses.user_id
      WHERE courses.id = ${courseId} AND courses.user_id = ${userId} AND users.account_state = 'active'
    )
    AND (SELECT COUNT(*) FROM attachments WHERE user_id = ${userId}) < ${MAX_ACCOUNT_ATTACHMENT_COUNT}
    AND (SELECT COALESCE(SUM(COALESCE(size_bytes, ${MAX_ATTACHMENT_BYTES})), 0) FROM attachments WHERE user_id = ${userId}) + ${file.size} <= ${MAX_ACCOUNT_ATTACHMENT_BYTES}
  `);
  if (reservation.meta.changes !== 1) throw new ConflictError('Attachment storage limit reached');

  try {
    await bucket.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  } catch (error) {
    await removePendingAfterStorageFailure(db, bucket, id, r2Key);
    throw error;
  }

  try {
  const finalized = await db.run(sql`
    UPDATE attachments SET state = 'ready', updated_at = ${Date.now()}
    WHERE id = ${id} AND user_id = ${userId} AND state = 'pending'
    AND EXISTS (SELECT 1 FROM users WHERE id = ${userId} AND account_state = 'active')
  `);
  if (finalized.meta.changes !== 1) {
    await removePendingAfterStorageFailure(db, bucket, id, r2Key);
    throw new NotFoundError('Course');
  }

  const rows = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  return rows[0];
  } catch (error) {
    await removePendingAfterStorageFailure(db, bucket, id, r2Key);
    throw error;
  }
}

export async function requireOwnedAttachment(db: Db, userId: string, attachmentId: string) {
  const rows = await db.select({ attachment: attachments }).from(attachments).innerJoin(users, eq(users.id, attachments.userId)).where(and(eq(attachments.id, attachmentId), eq(attachments.userId, userId), eq(users.accountState, 'active'))).limit(1);
  const attachment = rows[0]?.attachment;
  if (!attachment) throw new NotFoundError('Attachment');
  return attachment;
}

export async function getAttachmentObject(db: Db, bucket: R2Bucket, userId: string, attachmentId: string) {
  const attachment = await requireOwnedAttachment(db, userId, attachmentId);
  if (attachment.state !== 'ready') throw new NotFoundError('Attachment');
  const object = await bucket.get(attachment.r2Key);
  if (!object) throw new NotFoundError('Attachment object');
  const current = await requireOwnedAttachment(db, userId, attachmentId);
  if (current.state !== 'ready') throw new NotFoundError('Attachment');
  return { attachment, object };
}

export async function deleteAttachment(db: Db, bucket: R2Bucket, userId: string, attachmentId: string) {
  const attachment = await requireOwnedAttachment(db, userId, attachmentId);
  if (attachment.state !== 'ready') throw new NotFoundError('Attachment');
  const marked = await db.update(attachments).set({ state: 'deleting', updatedAt: Date.now() }).where(
    and(eq(attachments.id, attachmentId), eq(attachments.userId, userId), eq(attachments.state, 'ready'),
      sql`EXISTS (SELECT 1 FROM users WHERE id = ${userId} AND account_state = 'active')`),
  );
  if (marked.meta.changes !== 1) throw new NotFoundError('Attachment');
  // The active-account ready -> deleting CAS is the deletion admission point.
  // Once admitted, provider and metadata cleanup may finish after an account
  // fence without granting a new inactive-account deletion.
  await bucket.delete(attachment.r2Key);
  await db.delete(attachments).where(and(eq(attachments.id, attachmentId), eq(attachments.state, 'deleting')));
}

export async function reconcileAttachments(
  db: Db,
  bucket: R2Bucket,
  options: { now?: number; staleMs?: number; limit?: number } = {},
) {
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? 5 * 60_000;
  const rows = await db
    .select()
    .from(attachments)
    .where(and(inArray(attachments.state, ['pending', 'deleting']), lte(attachments.updatedAt, now - staleMs)))
    .limit(options.limit ?? 100);
  let repaired = 0;
  let retained = 0;

  for (const attachment of rows) {
    try {
      if (attachment.state === 'deleting') {
        // `deleting` records were admitted while the owner was active. This is
        // system cleanup of that durable intent, including after account fence.
        await bucket.delete(attachment.r2Key);
        await db.delete(attachments).where(and(eq(attachments.id, attachment.id), eq(attachments.state, 'deleting')));
        repaired += 1;
        continue;
      }

      // Pending objects were never acknowledged. Publishing them after a
      // failed response makes retries duplicate files; discard and release.
      await bucket.delete(attachment.r2Key);
      await db.delete(attachments).where(and(eq(attachments.id, attachment.id), eq(attachments.state, 'pending')));
      repaired += 1;
    } catch {
      retained += 1;
    }
  }
  return { scanned: rows.length, repaired, retained };
}
