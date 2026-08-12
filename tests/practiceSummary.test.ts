import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { assessments, branches, courses, events, kcs, users } from '../src/db/schema';
import { createAssessmentSchema, updateAssessmentSchema } from '../src/lib/schemas/assessments';
import { createAssessment } from '../src/lib/services/assessments';
import { getPracticeSummary } from '../src/lib/services/practiceSummary';
import { NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let branchId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  branchId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
});

describe('getPracticeSummary', () => {
  it('counts practice-typed events in the 30d window, distinct KCs all-time, and last_practiced', async () => {
    const kcA = crypto.randomUUID();
    const kcB = crypto.randomUUID();
    await db.insert(kcs).values([
      { id: kcA, branchId, courseId, name: 'KC A' },
      { id: kcB, branchId, courseId, name: 'KC B' },
    ]);

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    await db.insert(events).values([
      // In-window, counts toward practice_events_30d and KC coverage.
      { id: crypto.randomUUID(), userId, ts: now - 2 * day, type: 'practice_done', courseId, kcId: kcA, source: 'manual' },
      { id: crypto.randomUUID(), userId, ts: now - 5 * day, type: 'retrieval_practice', courseId, kcId: kcB, source: 'manual' },
      { id: crypto.randomUUID(), userId, ts: now - 10 * day, type: 'quiz_taken', courseId, kcId: kcA, source: 'manual' },
      { id: crypto.randomUUID(), userId, ts: now - 1 * day, type: 'tutor_session', courseId, kcId: null, source: 'tutor' },
      // Out of the 30d window, but still counts for all-time KC coverage / last_practiced.
      { id: crypto.randomUUID(), userId, ts: now - 60 * day, type: 'practice_done', courseId, kcId: kcB, source: 'manual' },
      // Wrong type — never counted.
      { id: crypto.randomUUID(), userId, ts: now - 1 * day, type: 'lecture_attended', courseId, kcId: null, source: 'manual' },
    ]);

    const summary = await getPracticeSummary(db, userId, courseId, now);
    expect(summary.practice_events_30d).toBe(4);
    expect(summary.distinctKcsPracticed).toBe(2); // kcA, kcB — all-time
    expect(summary.totalKcs).toBe(2);
    expect(summary.lastPracticedAt).toBe(now - 1 * day);
  });

  it('reports null last_practiced and zero counts with no practice activity', async () => {
    const summary = await getPracticeSummary(db, userId, courseId);
    expect(summary.practice_events_30d).toBe(0);
    expect(summary.distinctKcsPracticed).toBe(0);
    expect(summary.lastPracticedAt).toBeNull();
    expect(summary.practiceAssessmentsDone).toBe(0);
    expect(summary.practiceAssessmentsTotal).toBe(0);
  });

  it('counts practice assessments done (graded) vs total, ignoring official ones', async () => {
    await createAssessment(db, userId, courseId, { title: 'Midterm', type: 'midterm', kind: 'official' });
    await db.insert(assessments).values([
      { id: crypto.randomUUID(), courseId, title: 'Practice check 1', type: 'quiz', kind: 'practice', gradeReceived: 8, gradeMax: 10 },
      { id: crypto.randomUUID(), courseId, title: 'Practice check 2', type: 'quiz', kind: 'practice' },
    ]);

    const summary = await getPracticeSummary(db, userId, courseId);
    expect(summary.practiceAssessmentsTotal).toBe(2);
    expect(summary.practiceAssessmentsDone).toBe(1);
  });

  it('404s for a cross-user course id', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await expect(getPracticeSummary(db, otherUserId, courseId)).rejects.toThrow(NotFoundError);
  });
});

describe('assessments.kind', () => {
  it('rejects an invalid kind at the schema level', () => {
    expect(() => createAssessmentSchema.parse({ title: 'X', type: 'quiz', kind: 'bogus' })).toThrow();
    expect(() => updateAssessmentSchema.parse({ kind: 'bogus' })).toThrow();
  });

  it('defaults kind to official when omitted on create, and honors an explicit practice kind', async () => {
    const official = await createAssessment(db, userId, courseId, { title: 'Midterm', type: 'midterm' });
    expect(official.kind).toBe('official');

    const practice = await createAssessment(db, userId, courseId, { title: 'Practice midterm', type: 'midterm', kind: 'practice' });
    expect(practice.kind).toBe('practice');
  });
});
