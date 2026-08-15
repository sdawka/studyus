// Audit fix: entering a grade auto-completes the linked grade_entry task
// (pre-existing behavior); clearing it back to null must reopen that task,
// since the stable `grade_entry:<id>` dedupe key means the sweep can never
// regenerate a fresh row once ON CONFLICT DO NOTHING has seen it. Also
// covers the parallelized per-KC event fan-out on grade entry.
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { assessmentKcs, assessments, branches, courses, kcs, tasks, users } from '../src/db/schema';
import { updateAssessment } from '../src/lib/services/assessments';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let assessmentId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  assessmentId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
  await db.insert(assessments).values({ id: assessmentId, courseId, title: 'Quiz 1', type: 'quiz', gradeMax: 100, kind: 'official' });
});

async function insertGradeEntryTask(done: boolean) {
  const taskId = crypto.randomUUID();
  await db.insert(tasks).values({
    id: taskId,
    userId,
    title: 'Enter grade: Quiz 1',
    type: 'grade_entry',
    courseId,
    assessmentId,
    source: 'system',
    dedupeKey: `grade_entry:${assessmentId}`,
    done,
    completedAt: done ? Date.now() : null,
  });
  return taskId;
}

describe('grade_received null -> value', () => {
  it('auto-completes the linked grade_entry task', async () => {
    const taskId = await insertGradeEntryTask(false);
    await updateAssessment(db, userId, assessmentId, { grade_received: 90 });

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.done).toBe(true);
    expect(task.completedAt).not.toBeNull();
  });
});

describe('grade_received value -> null (audit fix: reopen)', () => {
  it('reopens the linked grade_entry task (done=false, completed_at=null)', async () => {
    const taskId = await insertGradeEntryTask(false);
    await updateAssessment(db, userId, assessmentId, { grade_received: 90 });
    let [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.done).toBe(true); // sanity: entering the grade completed it first

    await updateAssessment(db, userId, assessmentId, { grade_received: null });

    [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.done).toBe(false);
    expect(task.completedAt).toBeNull();
  });

  it('leaves dismissed_at untouched when reopening', async () => {
    const taskId = await insertGradeEntryTask(false);
    await db.update(tasks).set({ dismissedAt: Date.now() }).where(eq(tasks.id, taskId));
    await updateAssessment(db, userId, assessmentId, { grade_received: 90 });
    await updateAssessment(db, userId, assessmentId, { grade_received: null });

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.dismissedAt).not.toBeNull();
  });

  it('does nothing when there is no grade_entry task and no prior grade to clear', async () => {
    await expect(updateAssessment(db, userId, assessmentId, { grade_received: null })).resolves.toBeDefined();
  });

  it('does not fire on a null -> null no-op PATCH', async () => {
    const taskId = await insertGradeEntryTask(false);
    await updateAssessment(db, userId, assessmentId, { grade_received: null, weight_pct: 50 });

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.done).toBe(false); // unchanged — was never entered, so clearing again is a no-op
  });
});

describe('per-KC event fan-out stays correct when parallelized', () => {
  it('creates one mastery delta per linked KC and folds each into the right KC', async () => {
    const branchId = crypto.randomUUID();
    const kcA = crypto.randomUUID();
    const kcB = crypto.randomUUID();
    await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
    await db.insert(kcs).values([
      { id: kcA, branchId, courseId, name: 'KC A' },
      { id: kcB, branchId, courseId, name: 'KC B' },
    ]);
    await db.insert(assessmentKcs).values([
      { id: crypto.randomUUID(), assessmentId, kcId: kcA },
      { id: crypto.randomUUID(), assessmentId, kcId: kcB },
    ]);

    const { masteryDeltas } = await updateAssessment(db, userId, assessmentId, { grade_received: 90 });
    expect(masteryDeltas.map((d) => d.kc_id).sort()).toEqual([kcA, kcB].sort());

    const kcRows = await db.select().from(kcs).where(eq(kcs.courseId, courseId));
    for (const kc of kcRows) {
      expect(kc.mastery).toBeGreaterThan(0);
    }
  });
});
