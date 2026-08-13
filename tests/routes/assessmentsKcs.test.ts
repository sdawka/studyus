// v1.4 kc_ids: replace-links semantics on assessments, cross-course
// injection guard (both create and update), the qmatrix version bump, and
// the two behaviors that ride on top of the link set — grade-entry mastery
// fan-out uses whichever links are current *after* an in-flight kc_ids
// replace, and entering a grade auto-completes the linked grade_entry task.
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/client';
import { assessmentKcs, branches, courses, kcs, tasks, users } from '../../src/db/schema';
import { GET as getAssessments, POST as postAssessment } from '../../src/pages/api/v1/courses/[id]/assessments';
import { PATCH as patchAssessment } from '../../src/pages/api/v1/assessments/[id]';
import { createAssessment, updateAssessment } from '../../src/lib/services/assessments';
import { NotFoundError } from '../../src/lib/services/util';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let branchId: string;
let otherCourseId: string;
let kcA: string;
let kcB: string;
let kcOther: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  otherCourseId = crypto.randomUUID();
  branchId = crypto.randomUUID();
  kcA = crypto.randomUUID();
  kcB = crypto.randomUUID();
  kcOther = crypto.randomUUID();

  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values([
    { id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' },
    { id: otherCourseId, userId, code: 'TEST 202', slug: `test-${otherCourseId}`, title: 'Other Course' },
  ]);
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values([
    { id: kcA, branchId, courseId, name: 'KC A' },
    { id: kcB, branchId, courseId, name: 'KC B' },
    { id: kcOther, branchId, courseId: otherCourseId, name: 'KC Other' },
  ]);
});

describe('createAssessment kc_ids', () => {
  it('links the given KCs', async () => {
    const created = await createAssessment(db, userId, courseId, { title: 'Quiz 1', type: 'quiz', kc_ids: [kcA, kcB] });
    expect(new Set(created.kcIds)).toEqual(new Set([kcA, kcB]));
  });

  it('404s when a kc_id belongs to a different course (cross-course injection guard)', async () => {
    await expect(createAssessment(db, userId, courseId, { title: 'Quiz 1', type: 'quiz', kc_ids: [kcOther] })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('updateAssessment kc_ids', () => {
  it('replaces the link set and bumps qmatrix_version', async () => {
    const created = await createAssessment(db, userId, courseId, { title: 'Quiz 1', type: 'quiz', kc_ids: [kcA] });
    const before = await db.select().from(assessmentKcs).where(eq(assessmentKcs.assessmentId, created.id));
    expect(before).toHaveLength(1);
    expect(before[0]!.qmatrixVersion).toBe(1);

    const { assessment } = await updateAssessment(db, userId, created.id, { kc_ids: [kcB] });
    expect(assessment!.kcIds).toEqual([kcB]);

    const after = await db.select().from(assessmentKcs).where(eq(assessmentKcs.assessmentId, created.id));
    expect(after).toHaveLength(1);
    expect(after[0]!.kcId).toBe(kcB);
    expect(after[0]!.qmatrixVersion).toBe(2);
  });

  it('is a no-op (keeps qmatrix_version, does not churn rows) when the id set is unchanged', async () => {
    const created = await createAssessment(db, userId, courseId, { title: 'Quiz 1', type: 'quiz', kc_ids: [kcA, kcB] });
    const before = await db.select().from(assessmentKcs).where(eq(assessmentKcs.assessmentId, created.id));

    // Same set, different order on the wire — still a no-op.
    await updateAssessment(db, userId, created.id, { kc_ids: [kcB, kcA] });

    const after = await db.select().from(assessmentKcs).where(eq(assessmentKcs.assessmentId, created.id));
    expect(new Set(after.map((l) => l.id))).toEqual(new Set(before.map((l) => l.id))); // same rows, not deleted+reinserted
    expect(after.every((l) => l.qmatrixVersion === 1)).toBe(true);
  });

  it('clears all links when kc_ids is []', async () => {
    const created = await createAssessment(db, userId, courseId, { title: 'Quiz 1', type: 'quiz', kc_ids: [kcA] });
    const { assessment } = await updateAssessment(db, userId, created.id, { kc_ids: [] });
    expect(assessment!.kcIds).toEqual([]);
  });

  it('404s when a kc_id belongs to a different course', async () => {
    const created = await createAssessment(db, userId, courseId, { title: 'Quiz 1', type: 'quiz' });
    await expect(updateAssessment(db, userId, created.id, { kc_ids: [kcOther] })).rejects.toThrow(NotFoundError);
  });

  it('fans mastery events out over the NEW links when kc_ids and grade_received are set in the same PATCH', async () => {
    const created = await createAssessment(db, userId, courseId, { title: 'Quiz 1', type: 'quiz', kc_ids: [kcA] });

    const { masteryDeltas } = await updateAssessment(db, userId, created.id, {
      kc_ids: [kcB],
      grade_received: 90,
      grade_max: 100,
    });

    expect(masteryDeltas.map((d) => d.kc_id)).toEqual([kcB]);
    expect(masteryDeltas.map((d) => d.kc_id)).not.toContain(kcA);
  });

  it('auto-completes a linked grade_entry task when a grade is entered', async () => {
    const created = await createAssessment(db, userId, courseId, { title: 'Quiz 1', type: 'quiz' });
    const taskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: 'Enter grade: Quiz 1',
      type: 'grade_entry',
      assessmentId: created.id,
      source: 'system',
      dedupeKey: `grade_entry:${created.id}`,
      done: false,
    });

    await updateAssessment(db, userId, created.id, { grade_received: 80, grade_max: 100 });

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task!.done).toBe(true);
    expect(task!.completedAt).not.toBeNull();
  });
});

describe('GET /api/v1/courses/:id/assessments includes kc_ids', () => {
  it('returns kc_ids for each assessment', async () => {
    await createAssessment(db, userId, courseId, { title: 'Quiz 1', type: 'quiz', kc_ids: [kcA, kcB] });

    const response = await getAssessments({ params: { id: courseId }, locals: { user: { id: userId } } } as any);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(new Set(body.data[0].kc_ids)).toEqual(new Set([kcA, kcB]));
  });
});

describe('POST /api/v1/courses/:id/assessments includes kc_ids', () => {
  it('returns kc_ids on the created assessment, and 404s a cross-course kc_id via the route', async () => {
    const request = new Request(`http://local.test/api/v1/courses/${courseId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Quiz 1', type: 'quiz', kc_ids: [kcA] }),
    });
    const response = await postAssessment({ params: { id: courseId }, request, locals: { user: { id: userId } } } as any);
    expect(response.status).toBe(201);
    const body = (await response.json()) as any;
    expect(body.data.kc_ids).toEqual([kcA]);

    const badRequest = new Request(`http://local.test/api/v1/courses/${courseId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Quiz 2', type: 'quiz', kc_ids: [kcOther] }),
    });
    const badResponse = await postAssessment({ params: { id: courseId }, request: badRequest, locals: { user: { id: userId } } } as any);
    expect(badResponse.status).toBe(404);
  });
});

describe('PATCH /api/v1/assessments/:id kc_ids', () => {
  it('replaces links via the route and returns the new kc_ids', async () => {
    const created = await createAssessment(db, userId, courseId, { title: 'Quiz 1', type: 'quiz', kc_ids: [kcA] });

    const request = new Request(`http://local.test/api/v1/assessments/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ kc_ids: [kcB] }),
    });
    const response = await patchAssessment({ params: { id: created.id }, request, locals: { user: { id: userId } } } as any);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.data.kc_ids).toEqual([kcB]);
  });
});
