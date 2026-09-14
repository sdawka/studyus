import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { courses, users } from '../src/db/schema';
import { GET, POST } from '../src/pages/api/v1/courses/index';

const db = getDb(env.DB);
let userId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'clerk-managed' });
});

describe('POST /api/v1/courses', () => {
  it('adapts legacy manual course creation into a CourseDraftV2 aggregate', async () => {
    const response = await POST({
      request: new Request('http://local.test/api/v1/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'LEGACY 101', title: 'Legacy course' }),
      }),
      locals: { user: { id: userId } },
    } as never);

    expect(response.status).toBe(201);
    const body = await response.json() as { data: { id: string; code: string; slug: string; color_hue: number } };
    expect(body.data).toMatchObject({ code: 'LEGACY 101', slug: 'legacy-101', color_hue: 235 });
    expect(await db.select({ id: courses.id, code: courses.code, domainVersion: courses.domainVersion }).from(courses).where(and(
      eq(courses.userId, userId),
      eq(courses.code, 'LEGACY 101'),
    ))).toEqual([{ id: body.data.id, code: 'LEGACY 101', domainVersion: 2 }]);
  });

  it('keeps the course listing route available', async () => {
    const response = await GET({
      url: new URL('http://local.test/api/v1/courses'),
      locals: { user: { id: userId } },
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });
});
