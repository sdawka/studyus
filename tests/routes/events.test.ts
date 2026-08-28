import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/client';
import { branches, courses, eventIdempotencyKeys, events, kcs, users } from '../../src/db/schema';
import { POST } from '../../src/pages/api/v1/events/index';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let kcId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  kcId = crypto.randomUUID();

  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Test KC' });
});

describe('POST /api/v1/events', () => {
  async function post(body: Record<string, unknown>, idempotencyKey?: string) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
    const request = new Request('http://local.test/api/v1/events', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return POST({ request, locals: { user: { id: userId } } } as any);
  }

  it('creates a manual event and returns mastery deltas in the envelope', async () => {
    const request = new Request('http://local.test/api/v1/events', {
      method: 'POST',
      body: JSON.stringify({ type: 'lecture_attended', course_id: courseId, kc_id: kcId }),
    });

    const response = await POST({ request, locals: { user: { id: userId } } } as any);
    expect(response.status).toBe(201);

    const body = (await response.json()) as any;
    expect(body.data.type).toBe('lecture_attended');
    expect(body.data).toHaveProperty('is_instructional');
    expect(body.data.is_instructional).toBe(true);
    expect(body.data.mastery_deltas).toHaveLength(1);
    expect(body.data.mastery_deltas[0].kc_id).toBe(kcId);
  });

  it('rejects an invalid event type with a 400 envelope error', async () => {
    const request = new Request('http://local.test/api/v1/events', {
      method: 'POST',
      body: JSON.stringify({ type: 'not_a_real_type', course_id: courseId }),
    });

    const response = await POST({ request, locals: { user: { id: userId } } } as any);
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error).toBeDefined();
  });

  it('returns 200 and the replay header for an exact keyed retry without refolding', async () => {
    const key = crypto.randomUUID();
    const first = await post(
      {
        type: 'quiz_taken',
        course_id: courseId,
        kc_id: kcId,
        ts: '2026-08-28T16:00:00.000Z',
        payload: { score: 80, nested: { beta: 2, alpha: 1 } },
      },
      key.toUpperCase(),
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as any;

    const replay = await post(
      {
        payload: { nested: { alpha: 1, beta: 2 }, score: 80 },
        ts: '2026-08-28T12:00:00.000-04:00',
        kc_id: kcId,
        course_id: courseId,
        type: 'quiz_taken',
      },
      key,
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
    const replayBody = (await replay.json()) as any;
    expect(replayBody.data.id).toBe(firstBody.data.id);
    expect(replayBody.data.mastery_deltas).toEqual([]);
    expect(replayBody.data.ts).toBe('2026-08-28T16:00:00.000Z');
    expect(await db.select().from(events).where(eq(events.userId, userId))).toHaveLength(1);
    expect((await db.select().from(eventIdempotencyKeys).where(eq(eventIdempotencyKeys.userId, userId)))[0].idempotencyKey).toBe(key);
  });

  it.each([
    ['type', { type: 'assignment_graded' }],
    ['kc', { kc_id: undefined }],
    ['course', { course_id: undefined }],
    ['timestamp', { ts: '2026-08-28T16:00:01.000Z' }],
    ['payload', { payload: { score: 81 } }],
  ])('returns idempotency_conflict when a key is reused with changed %s', async (_field, change) => {
    const key = crypto.randomUUID();
    const base = {
      type: 'quiz_taken',
      course_id: courseId,
      kc_id: kcId,
      ts: '2026-08-28T16:00:00.000Z',
      payload: { score: 80 },
    };
    expect((await post(base, key)).status).toBe(201);

    const conflict = await post({ ...base, ...change }, key);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()) as any).toMatchObject({ error: { code: 'idempotency_conflict' } });
    expect(await db.select().from(events).where(eq(events.userId, userId))).toHaveLength(1);
  });

  it('rejects a malformed Idempotency-Key without writing', async () => {
    const response = await post({ type: 'reading_done' }, 'not-a-uuid');
    expect(response.status).toBe(400);
    expect((await response.json()) as any).toMatchObject({ error: { code: 'invalid_input' } });
    expect(await db.select().from(events).where(eq(events.userId, userId))).toHaveLength(0);
  });

  it('does not reserve a key when ownership validation fails', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    const key = crypto.randomUUID();
    const request = new Request('http://local.test/api/v1/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ type: 'reading_done', course_id: courseId }),
    });

    const response = await POST({ request, locals: { user: { id: otherUserId } } } as any);
    expect(response.status).toBe(404);
    expect(await db.select().from(eventIdempotencyKeys).where(eq(eventIdempotencyKeys.userId, otherUserId))).toHaveLength(0);
  });

  it('keeps unkeyed v1 clients backward-compatible and non-idempotent', async () => {
    expect((await post({ type: 'reading_done' })).status).toBe(201);
    expect((await post({ type: 'reading_done' })).status).toBe(201);
    expect(await db.select().from(events).where(eq(events.userId, userId))).toHaveLength(2);
    expect(await db.select().from(eventIdempotencyKeys).where(eq(eventIdempotencyKeys.userId, userId))).toHaveLength(0);
  });

  it.each([
    'task_completed',
    'task_dismissed',
    'correction_dismissed',
    'recommendation_followed',
    'recommendation_ignored',
    'course_archived',
    'plan_committed',
    'session_scheduled',
    'session_rescheduled',
    'settings_changed',
    'coach_session',
    'reflection_captured',
    'digest_sent',
  ])('rejects retired domain event type %s', async (type) => {
    const request = new Request('http://local.test/api/v1/events', {
      method: 'POST',
      body: JSON.stringify({ type, course_id: courseId, kc_id: kcId }),
    });

    const response = await POST({ request, locals: { user: { id: userId } } } as any);
    expect(response.status).toBe(400);
    expect(await db.select().from(events).where(eq(events.userId, userId))).toHaveLength(0);
  });
});
