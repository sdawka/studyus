import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/client';
import { branches, courses, events, kcs, users } from '../../src/db/schema';
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

  it('records recommendation feedback as context without changing mastery', async () => {
    await POST({
      request: new Request('http://local.test/api/v1/events', {
        method: 'POST',
        body: JSON.stringify({ type: 'retrieval_practice', course_id: courseId, kc_id: kcId, payload: { correct: true } }),
      }),
      locals: { user: { id: userId } },
    } as any);
    const [before] = await db.select().from(kcs).where(eq(kcs.id, kcId));
    const request = new Request('http://local.test/api/v1/events', {
      method: 'POST',
      body: JSON.stringify({
        type: 'recommendation_followed',
        course_id: courseId,
        kc_id: kcId,
        payload: { action_id: `understand:${kcId}:none:25`, available_minutes: 25 },
      }),
    });

    const response = await POST({ request, locals: { user: { id: userId } } } as any);
    expect(response.status).toBe(201);
    const logged = await db.select().from(events).where(eq(events.kcId, kcId));
    expect(logged.at(-1)).toMatchObject({ type: 'recommendation_followed', isInstructional: false, isAssessment: false });
    const [kc] = await db.select().from(kcs).where(eq(kcs.id, kcId));
    expect(kc.mastery).toBe(before.mastery);
  });
});
