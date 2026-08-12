// Route-level reproduction for the three issues attendance-ui reported live
// against :4321 (kind returning the literal string "kind", POST with
// kind:"practice" 500ing, GET practice-summary 404ing). Run against the
// isolated per-file D1 (real migrations applied fresh) to distinguish a
// real data-plane bug from dev-server/module staleness on the shared
// long-running :4321 instance.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/client';
import { assessments, courses, users } from '../../src/db/schema';
import { GET as getAssessments, POST as postAssessment } from '../../src/pages/api/v1/courses/[id]/assessments';
import { GET as getPracticeSummary } from '../../src/pages/api/v1/courses/[id]/practice-summary';

const db = getDb(env.DB);

let userId: string;
let courseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
});

describe('GET /api/v1/courses/:id/assessments', () => {
  it('returns the real kind value, not the literal string "kind"', async () => {
    await db.insert(assessments).values({ id: crypto.randomUUID(), courseId, title: 'Midterm', type: 'midterm' });

    const response = await getAssessments({ params: { id: courseId }, locals: { user: { id: userId } } } as any);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.data[0].kind).toBe('official');
  });
});

describe('POST /api/v1/courses/:id/assessments with kind: "practice"', () => {
  it('creates the assessment instead of 500ing', async () => {
    const request = new Request(`http://local.test/api/v1/courses/${courseId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Practice set 1', type: 'quiz', kind: 'practice' }),
    });

    const response = await postAssessment({ params: { id: courseId }, request, locals: { user: { id: userId } } } as any);
    const body = (await response.json()) as any;
    expect(response.status).toBe(201);
    expect(body.data.kind).toBe('practice');
  });
});

describe('GET /api/v1/courses/:id/practice-summary', () => {
  it('resolves (not a 404) and returns the documented shape', async () => {
    const response = await getPracticeSummary({ params: { id: courseId }, locals: { user: { id: userId } } } as any);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.data).toMatchObject({
      practice_events_30d: 0,
      distinct_kcs_practiced: 0,
      total_kcs: 0,
      last_practiced_at: null,
      practice_assessments_done: 0,
      practice_assessments_total: 0,
    });
  });
});
