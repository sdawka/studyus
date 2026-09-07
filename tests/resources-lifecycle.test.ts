import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, kcs, resources, users } from '../src/db/schema';
import { createResource, deleteResource, listResources } from '../src/lib/services/resources';
import { NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);
let userId: string;
let otherUserId: string;
let courseId: string;
let otherCourseId: string;
let kcId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  otherUserId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  otherCourseId = crypto.randomUUID();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test.local`, passwordHash: 'x' },
    { id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' },
  ]);
  await db.insert(courses).values([
    { id: courseId, userId, code: 'OWN 101', slug: `own-${courseId}`, title: 'Own' },
    { id: otherCourseId, userId: otherUserId, code: 'OTHER 101', slug: `other-${otherCourseId}`, title: 'Other' },
  ]);
  const branchId = crypto.randomUUID();
  kcId = crypto.randomUUID();
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'KC' });
});

const input = (extra = {}) => ({ url: 'https://example.com/read', label: 'Reading', ...extra });

describe('resources lifecycle', () => {
  it('persists and lists owned resources with course and kind filters', async () => {
    const linked = await createResource(db, userId, input({ course_id: courseId, kc_id: kcId }));
    const unlinked = await createResource(db, userId, input({ label: 'Unlinked' }));
    await createResource(db, otherUserId, input({ label: 'Foreign' }));
    expect((await listResources(db, userId, {})).map((r) => r.id).sort()).toEqual([linked.id, unlinked.id].sort());
    expect((await listResources(db, userId, { course: courseId })).map((r) => r.id)).toEqual([linked.id]);
    expect((await listResources(db, userId, { kind: 'user_shared' })).length).toBe(2);
    expect((await listResources(db, userId, { kind: 'canonical' })).map((r) => r.id)).toEqual([]);
  });

  it('rejects a foreign course before writing', async () => {
    await expect(createResource(db, userId, input({ course_id: otherCourseId }))).rejects.toThrow(NotFoundError);
    expect(await db.select().from(resources).where(eq(resources.userId, userId))).toHaveLength(0);
  });

  it('rejects a foreign KC before writing', async () => {
    const foreignBranchId = crypto.randomUUID();
    const foreignKcId = crypto.randomUUID();
    await db.insert(branches).values({ id: foreignBranchId, courseId: otherCourseId, name: 'Foreign Branch' });
    await db.insert(kcs).values({ id: foreignKcId, branchId: foreignBranchId, courseId: otherCourseId, name: 'Foreign KC' });
    await expect(createResource(db, userId, input({ kc_id: foreignKcId }))).rejects.toThrow(NotFoundError);
    expect(await db.select().from(resources).where(eq(resources.userId, userId))).toHaveLength(0);
  });

  it('deletes only an owned resource and rejects foreign ids', async () => {
    const created = await createResource(db, userId, input());
    await expect(deleteResource(db, otherUserId, created.id)).rejects.toThrow(NotFoundError);
    expect(await db.select().from(resources).where(eq(resources.id, created.id))).toHaveLength(1);
    await deleteResource(db, userId, created.id);
    expect(await db.select().from(resources).where(eq(resources.id, created.id))).toHaveLength(0);
  });
});
