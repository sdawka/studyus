import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { attachments, courses, users } from '../src/db/schema';
import { createResourceSchema } from '../src/lib/schemas/resources';
import { createAttachment } from '../src/lib/services/attachments';
import { DELETE, GET } from '../src/pages/api/v1/attachments/[id]';

const db = getDb(env.DB);

let ownerId: string;
let foreignUserId: string;
let attachmentId: string;
let attachmentKey: string;
let activeContentResponse: Response;
let unsafeProtocolAcceptance: boolean[];

beforeEach(async () => {
  ownerId = crypto.randomUUID();
  foreignUserId = crypto.randomUUID();
  const courseId = crypto.randomUUID();
  await db.insert(users).values([
    { id: ownerId, email: `${ownerId}@test.local`, passwordHash: 'x' },
    { id: foreignUserId, email: `${foreignUserId}@test.local`, passwordHash: 'x' },
  ]);
  await db.insert(courses).values({
    id: courseId,
    userId: ownerId,
    code: 'SEC 101',
    slug: `security-${courseId}`,
    title: 'Security fixture',
  });

  const uploaded = await createAttachment(
    db,
    env.UPLOADS,
    ownerId,
    courseId,
    new File(['<script>globalThis.__attachmentScriptRan = true</script>'], 'active.html', {
      type: 'text/html',
    }),
  );
  attachmentId = uploaded.id;
  attachmentKey = uploaded.r2Key;
  activeContentResponse = await GET({
    params: { id: attachmentId },
    locals: { user: { id: ownerId } },
  } as any);
  expect(activeContentResponse.status).toBe(200);
  expect(await activeContentResponse.clone().text()).toBe('<script>globalThis.__attachmentScriptRan = true</script>');
  unsafeProtocolAcceptance = [
    'javascript:alert(document.domain)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
  ].map((url) => createResourceSchema.safeParse({ url, label: 'unsafe' }).success);
});

describe('attachment isolation', () => {
  it('denies another user read and delete access without changing metadata or R2', async () => {
    const context = {
      params: { id: attachmentId },
      locals: { user: { id: foreignUserId } },
    } as any;

    const beforeMetadata = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
    const beforeObject = await env.UPLOADS.get(attachmentKey);
    expect(beforeMetadata).toHaveLength(1);
    expect(beforeObject).not.toBeNull();
    const beforeContent = await beforeObject!.text();
    const readResponse = await GET(context);
    const deleteResponse = await DELETE(context);

    expect(readResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(404);
    const deniedBody = { error: { code: 'not_found', message: 'Attachment not found' } };
    expect(await readResponse.json()).toEqual(deniedBody);
    expect(await deleteResponse.json()).toEqual(deniedBody);
    expect(await db.select().from(attachments).where(eq(attachments.id, attachmentId))).toEqual(beforeMetadata);
    const afterObject = await env.UPLOADS.get(attachmentKey);
    expect(afterObject).not.toBeNull();
    expect(await afterObject!.text()).toBe(beforeContent);
  });
});

describe('active-content boundaries', () => {
  it.fails('serves uploads as downloads with browser MIME sniffing disabled', () => {
    expect({
      disposition: activeContentResponse.headers.get('content-disposition'),
      contentType: activeContentResponse.headers.get('content-type'),
      noSniff: activeContentResponse.headers.get('x-content-type-options'),
    }).toEqual({
      disposition: 'attachment; filename="active.html"',
      contentType: 'application/octet-stream',
      noSniff: 'nosniff',
    });
  });

  it.fails('accepts only HTTP(S) resource links', () => {
    expect(unsafeProtocolAcceptance).toEqual([false, false, false]);
  });
});
