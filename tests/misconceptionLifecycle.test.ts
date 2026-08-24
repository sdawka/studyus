import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, events, kcs, misconceptions, users } from '../src/db/schema';
import { advanceUserMisconception, listUserMisconceptions } from '../src/lib/services/misconceptionLifecycle';

const db = getDb(env.DB);

let userId: string;
let misconceptionId: string;
let eventId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  const courseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  const kcId = crypto.randomUUID();
  misconceptionId = crypto.randomUUID();
  eventId = crypto.randomUUID();

  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'KC' });
  await db.insert(misconceptions).values({
    id: misconceptionId,
    kcId,
    slug: 'mistake',
    name: 'Mistake',
    description: 'Wrong belief.',
    rootCause: 'Overgeneralization.',
    diagnosticProbe: 'Probe?',
    correction: 'Correct belief.',
  });
  await db.insert(events).values({
    id: eventId,
    userId,
    ts: Date.now(),
    type: 'diagnostic_probe',
    isInstructional: false,
    isAssessment: true,
    kcId,
    courseId,
    sessionId: null,
    payload: { correct: false },
    source: 'session',
    createdAt: Date.now(),
  });
});

describe('misconception lifecycle', () => {
  it('advances monotonically and preserves unique evidence ids', async () => {
    const suspected = await advanceUserMisconception(db, userId, {
      misconception_id: misconceptionId,
      status: 'suspected',
      evidence_event_id: eventId,
    });
    expect(suspected.status).toBe('suspected');
    expect(suspected.suspectedAt).not.toBeNull();

    const correcting = await advanceUserMisconception(db, userId, {
      misconception_id: misconceptionId,
      status: 'correcting',
      evidence_event_id: eventId,
    });
    expect(correcting.status).toBe('correcting');
    expect(correcting.confirmedAt).not.toBeNull();
    expect(correcting.correctingAt).not.toBeNull();
    expect(correcting.evidenceEventIds).toEqual([eventId]);

    const noRegression = await advanceUserMisconception(db, userId, {
      misconception_id: misconceptionId,
      status: 'suspected',
    });
    expect(noRegression.status).toBe('correcting');
    expect(await listUserMisconceptions(db, userId)).toHaveLength(1);
  });
});
