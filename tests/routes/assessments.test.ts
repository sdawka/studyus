import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/client';
import { assessmentKcs, assessments, branches, courses, kcs, users } from '../../src/db/schema';
import { PATCH } from '../../src/pages/api/v1/assessments/[id]';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let kcId: string;
let assessmentId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  kcId = crypto.randomUUID();
  assessmentId = crypto.randomUUID();

  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Test KC' });
  await db.insert(assessments).values({ id: assessmentId, courseId, title: 'Midterm', type: 'midterm', weightPct: 30, gradeMax: 100 });
  await db.insert(assessmentKcs).values({ id: crypto.randomUUID(), assessmentId, kcId });
});

describe('PATCH /api/v1/assessments/:id (grade entry)', () => {
  it('entering grade_received appends an exam_graded event per linked KC and moves mastery', async () => {
    const request = new Request(`http://local.test/api/v1/assessments/${assessmentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ grade_received: 85 }),
    });

    const response = await PATCH({ params: { id: assessmentId }, request, locals: { user: { id: userId } } } as any);
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.data.grade_received).toBe(85);
    expect(body.data.mastery_deltas).toHaveLength(1);
    expect(body.data.mastery_deltas[0].kc_id).toBe(kcId);
    expect(body.data.mastery_deltas[0].new_mastery).toBeGreaterThan(0);

    const kcRows = await db.select().from(kcs).where(eq(kcs.id, kcId)).limit(1);
    expect(kcRows[0].mastery).toBe(body.data.mastery_deltas[0].new_mastery);
  });
});
