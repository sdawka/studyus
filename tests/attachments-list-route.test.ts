import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { attachments, courses, users } from '../src/db/schema';
import { GET } from '../src/pages/api/v1/courses/[id]/attachments';

const db = getDb(env.DB);

async function createUser(state: 'active' | 'deleting' = 'active') {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email: `${id}@test.local`, passwordHash: 'x', accountState: state });
  return id;
}

function invoke(courseId: string, userId: string) {
  return GET({ params: { id: courseId }, locals: { user: { id: userId } } } as never) as Promise<Response>;
}

describe('GET /api/v1/courses/:id/attachments', () => {
  it('lists only ready attachment metadata for the active course owner', async () => {
    const ownerId = await createUser();
    const outsiderId = await createUser();
    const courseId = crypto.randomUUID();
    await db.insert(courses).values({ id: courseId, userId: ownerId, code: 'FILES', slug: `files-${courseId}`, title: 'Files' });
    await db.insert(attachments).values([
      { id: 'ready-file', userId: ownerId, courseId, r2Key: `${ownerId}/private-ready`, filename: 'ready.pdf', contentType: 'application/pdf', sizeBytes: 42, state: 'ready', createdAt: 3, updatedAt: 3 },
      { id: 'pending-file', userId: ownerId, courseId, r2Key: `${ownerId}/private-pending`, filename: 'pending.txt', contentType: 'text/plain', sizeBytes: 7, state: 'pending', createdAt: 2, updatedAt: 2 },
      { id: 'deleting-file', userId: ownerId, courseId, r2Key: `${ownerId}/private-deleting`, filename: 'deleting.txt', contentType: 'text/plain', sizeBytes: 8, state: 'deleting', createdAt: 1, updatedAt: 1 },
    ]);

    const response = await invoke(courseId, ownerId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { attachments: [{
      attachment_id: 'ready-file', filename: 'ready.pdf', size_bytes: 42, mime_type: 'application/pdf',
    }] } });

    expect((await invoke(courseId, outsiderId)).status).toBe(404);
    await db.update(users).set({ accountState: 'deleting' }).where(eq(users.id, ownerId));
    expect((await invoke(courseId, ownerId)).status).toBe(404);
  });

  it('bounds the picker response at the account attachment limit without exposing storage keys', async () => {
    const ownerId = await createUser();
    const courseId = crypto.randomUUID();
    await db.insert(courses).values({ id: courseId, userId: ownerId, code: 'BOUND', slug: `bound-${courseId}`, title: 'Bounded files' });
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: crypto.randomUUID(), userId: ownerId, courseId, r2Key: `${ownerId}/secret-${index}`,
      filename: `file-${index}.txt`, contentType: 'text/plain', sizeBytes: index + 1,
      state: 'ready' as const, createdAt: index, updatedAt: index,
    }));
    for (let offset = 0; offset < rows.length; offset += 8) {
      await db.insert(attachments).values(rows.slice(offset, offset + 8));
    }

    const response = await invoke(courseId, ownerId);
    const body = await response.json() as { data: { attachments: Array<Record<string, unknown>> } };
    expect(body.data.attachments).toHaveLength(100);
    expect(JSON.stringify(body)).not.toContain('r2_key');
    expect(JSON.stringify(body)).not.toContain('secret-');
  });
});
