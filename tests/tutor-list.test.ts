import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, kcs, users } from '../src/db/schema';
import { createConversation, listConversations } from '../src/lib/services/tutor/conversations';

const db = getDb(env.DB);

let userId: string;

async function makeCourse() {
  const courseId = crypto.randomUUID();
  await db.insert(courses).values({ id: courseId, userId, code: `T-${courseId.slice(0, 6)}`, slug: `t-${courseId}`, title: 'Test Course' });
  return courseId;
}

async function makeKc(courseId: string, name: string) {
  const branchId = crypto.randomUUID();
  const kcId = crypto.randomUUID();
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name, kcType: 'principle' });
  return kcId;
}

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
});

describe('listConversations', () => {
  it('filters by course and joins kc_name', async () => {
    const courseA = await makeCourse();
    const courseB = await makeCourse();
    const kcA = await makeKc(courseA, 'Bernoulli principle');
    const kcB = await makeKc(courseB, 'Navier-Stokes');

    await createConversation(db, userId, { kc_id: kcA });
    await createConversation(db, userId, { kc_id: kcB });

    const results = await listConversations(db, userId, { limit: 20 });
    expect(results).toHaveLength(2);

    const filtered = await listConversations(db, userId, { course: courseA, limit: 20 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].kcName).toBe('Bernoulli principle');
    expect(filtered[0].kcId).toBe(kcA);
  });

  it('returns newest-first and respects limit', async () => {
    const courseId = await makeCourse();
    const kcId = await makeKc(courseId, 'KC');
    await createConversation(db, userId, { kc_id: kcId });
    await createConversation(db, userId, { kc_id: kcId });
    await createConversation(db, userId, { kc_id: kcId });

    const results = await listConversations(db, userId, { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('filters by kc', async () => {
    const courseId = await makeCourse();
    const kcA = await makeKc(courseId, 'KC A');
    const kcB = await makeKc(courseId, 'KC B');
    await createConversation(db, userId, { kc_id: kcA });
    await createConversation(db, userId, { kc_id: kcB });

    const results = await listConversations(db, userId, { kc: kcA, limit: 20 });
    expect(results).toHaveLength(1);
    expect(results[0].kcId).toBe(kcA);
  });
});
