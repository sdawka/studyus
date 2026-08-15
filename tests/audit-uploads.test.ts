// Audit fix: attachments.createAttachment previously buffered any upload via
// file.arrayBuffer() with no size check. Now rejects files over
// MAX_ATTACHMENT_BYTES (10 MB), checked against file.size before ever
// reading the buffer, surfaced as the same ZodError -> 400 invalid_input
// envelope every other schema violation in this API uses.
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { attachments, courses, users } from '../src/db/schema';
import { MAX_ATTACHMENT_BYTES } from '../src/lib/schemas/attachments';
import { createAttachment } from '../src/lib/services/attachments';
import { POST as uploadRoute } from '../src/pages/api/v1/courses/[id]/attachments';
import { ZodError } from 'zod';

const db = getDb(env.DB);

let userId: string;
let courseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
});

function fileOfSize(bytes: number, name: string): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/octet-stream' });
}

describe('createAttachment — size cap', () => {
  it('rejects a file over 10 MB with a ZodError, and writes nothing to the DB', async () => {
    const oversized = fileOfSize(MAX_ATTACHMENT_BYTES + 1, 'big.bin');
    await expect(createAttachment(db, env.UPLOADS, userId, courseId, oversized)).rejects.toThrow(ZodError);

    const rows = await db.select().from(attachments).where(eq(attachments.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it('accepts a file at exactly the cap', async () => {
    const atCap = fileOfSize(MAX_ATTACHMENT_BYTES, 'exact.bin');
    const attachment = await createAttachment(db, env.UPLOADS, userId, courseId, atCap);
    expect(attachment.sizeBytes).toBe(MAX_ATTACHMENT_BYTES);
  });

  it('accepts a small file as before', async () => {
    const small = fileOfSize(10, 'small.bin');
    const attachment = await createAttachment(db, env.UPLOADS, userId, courseId, small);
    expect(attachment.sizeBytes).toBe(10);
  });
});

describe('POST /courses/:id/attachments route — oversized upload', () => {
  it('responds 400 invalid_input for a file over the cap', async () => {
    const oversized = fileOfSize(MAX_ATTACHMENT_BYTES + 1, 'big.bin');
    const formData = new FormData();
    formData.append('file', oversized);

    const res = await uploadRoute({
      params: { id: courseId },
      request: new Request('http://local.test/api/v1', { method: 'POST', body: formData }),
      locals: { user: { id: userId } },
    } as any);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('invalid_input');
  });
});
