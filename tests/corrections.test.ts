import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, kcs, misconceptions, tutorConversations, users } from '../src/db/schema';
import { createCorrection, listCorrections, updateCorrection } from '../src/lib/services/corrections';
import { NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let branchId: string;
let kcId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  branchId = crypto.randomUUID();
  kcId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'CHEE 310', slug: `chee-310-${courseId}`, title: 'Fluid Mechanics' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Bernoulli equation', kcType: 'concept', slug: 'bernoulli-equation' });
});

describe('createCorrection', () => {
  it('creates a KC-scoped correction, stamping accepted_at/status server-side, joined with kc_name/course_slug', async () => {
    const before = Date.now();
    const created = await createCorrection(db, userId, {
      kc_id: kcId,
      correction: "Bernoulli's equation only applies along a streamline in steady flow.",
      prior_belief: 'It relates any two points in a flow.',
    });

    expect(created.status).toBe('active');
    expect(created.acceptedAt).toBeGreaterThanOrEqual(before);
    expect(created.kcName).toBe('Bernoulli equation');
    expect(created.courseSlug).toBe(`chee-310-${courseId}`);
    expect(created.kcId).toBe(kcId);
  });

  it('creates a freeform correction (no kc_id) with null kc_name/course_slug', async () => {
    const created = await createCorrection(db, userId, { correction: 'Always check units before comparing values.' });
    expect(created.kcId).toBeNull();
    expect(created.kcName).toBeNull();
    expect(created.courseSlug).toBeNull();
  });

  it('resolves misconception_id (seed content, no owner check) and links it', async () => {
    const misconceptionId = crypto.randomUUID();
    await db.insert(misconceptions).values({
      id: misconceptionId,
      kcId,
      slug: 'bernoulli-between-any-two-points',
      name: 'Bernoulli relates any two points',
      description: 'Assumed to hold between any two arbitrary points.',
      rootCause: 'Missing the streamline precondition.',
      diagnosticProbe: 'Are the two points on the same streamline?',
      correction: 'Bernoulli only relates points on the same streamline in steady flow.',
    });

    const created = await createCorrection(db, userId, {
      kc_id: kcId,
      misconception_id: misconceptionId,
      correction: 'Bernoulli only relates points on the same streamline in steady flow.',
    });
    expect(created.misconceptionId).toBe(misconceptionId);
  });

  it('resolves source_conversation_id, ownership-checked against the caller\'s own tutor_conversations', async () => {
    const conversationId = crypto.randomUUID();
    await db.insert(tutorConversations).values({ id: conversationId, userId, kcId, mode: 'absorb' });

    const created = await createCorrection(db, userId, {
      kc_id: kcId,
      source_conversation_id: conversationId,
      correction: 'Corrected via tutor.',
    });
    expect(created.sourceConversationId).toBe(conversationId);
  });

  it('404s on a kc_id owned by another user', async () => {
    const otherUserId = crypto.randomUUID();
    const otherCourseId = crypto.randomUUID();
    const otherBranchId = crypto.randomUUID();
    const otherKcId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'X 1', slug: `other-${otherCourseId}`, title: 'Other' });
    await db.insert(branches).values({ id: otherBranchId, courseId: otherCourseId, name: 'B' });
    await db.insert(kcs).values({ id: otherKcId, branchId: otherBranchId, courseId: otherCourseId, name: 'Other', kcType: 'concept' });

    await expect(createCorrection(db, userId, { kc_id: otherKcId, correction: 'x' })).rejects.toThrow(NotFoundError);
  });

  it('404s on a nonexistent misconception_id', async () => {
    await expect(
      createCorrection(db, userId, { misconception_id: crypto.randomUUID(), correction: 'x' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('404s on a source_conversation_id owned by another user', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    const otherConversationId = crypto.randomUUID();
    await db.insert(tutorConversations).values({ id: otherConversationId, userId: otherUserId, kcId, mode: 'absorb' });

    await expect(
      createCorrection(db, userId, { source_conversation_id: otherConversationId, correction: 'x' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('listCorrections', () => {
  it('lists newest (accepted_at desc) first and filters by status', async () => {
    const first = await createCorrection(db, userId, { correction: 'First' });
    await new Promise((r) => setTimeout(r, 5));
    const second = await createCorrection(db, userId, { correction: 'Second' });

    const all = await listCorrections(db, userId);
    expect(all.map((c) => c.id)).toEqual([second.id, first.id]);

    await updateCorrection(db, userId, first.id, { status: 'internalized' });

    const active = await listCorrections(db, userId, { status: 'active' });
    expect(active.map((c) => c.id)).toEqual([second.id]);

    const internalized = await listCorrections(db, userId, { status: 'internalized' });
    expect(internalized.map((c) => c.id)).toEqual([first.id]);
  });

  it('scopes strictly to the caller — never lists another user\'s corrections', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await createCorrection(db, otherUserId, { correction: 'Not mine' });
    await createCorrection(db, userId, { correction: 'Mine' });

    const rows = await listCorrections(db, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].correction).toBe('Mine');
  });
});

describe('updateCorrection', () => {
  it('transitions status active -> internalized', async () => {
    const created = await createCorrection(db, userId, { correction: 'x' });
    const updated = await updateCorrection(db, userId, created.id, { status: 'internalized' });
    expect(updated.status).toBe('internalized');
  });

  it('404s on a correction owned by another user', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    const created = await createCorrection(db, otherUserId, { correction: 'x' });

    await expect(updateCorrection(db, userId, created.id, { status: 'internalized' })).rejects.toThrow(NotFoundError);
  });
});
