// R2-backed attachments. Key convention: userId/courseId/uuid-filename (or
// userId/_/uuid-filename when not course-scoped) so objects stay listable
// per-user without a separate index if R2 is ever browsed directly.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { attachments } from '../../db/schema';
import { NotFoundError, requireOwnedCourse } from './util';

export async function createAttachment(
  db: Db,
  bucket: R2Bucket,
  userId: string,
  courseId: string,
  file: File,
) {
  await requireOwnedCourse(db, userId, courseId);

  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\-]/g, '_');
  const r2Key = `${userId}/${courseId}/${id}-${safeName}`;

  const buffer = await file.arrayBuffer();
  await bucket.put(r2Key, buffer, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });

  await db.insert(attachments).values({
    id,
    userId,
    courseId,
    r2Key,
    filename: file.name,
    contentType: file.type || null,
    sizeBytes: buffer.byteLength,
  });

  const rows = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  return rows[0];
}

export async function requireOwnedAttachment(db: Db, userId: string, attachmentId: string) {
  const rows = await db.select().from(attachments).where(and(eq(attachments.id, attachmentId), eq(attachments.userId, userId))).limit(1);
  const attachment = rows[0];
  if (!attachment) throw new NotFoundError('Attachment');
  return attachment;
}

export async function getAttachmentObject(db: Db, bucket: R2Bucket, userId: string, attachmentId: string) {
  const attachment = await requireOwnedAttachment(db, userId, attachmentId);
  const object = await bucket.get(attachment.r2Key);
  if (!object) throw new NotFoundError('Attachment object');
  return { attachment, object };
}

export async function deleteAttachment(db: Db, bucket: R2Bucket, userId: string, attachmentId: string) {
  const attachment = await requireOwnedAttachment(db, userId, attachmentId);
  await bucket.delete(attachment.r2Key);
  await db.delete(attachments).where(eq(attachments.id, attachmentId));
}
