import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { assessmentKcs, assessments, branches, courses, kcs, taskCourses, tasks, users } from '../src/db/schema';
import { createAssessment, updateAssessment } from '../src/lib/services/assessments';
import { createTask, updateTask } from '../src/lib/services/tasks';
import { NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let ownKcId: string;
let foreignKcId: string;
let foreignCourseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  const foreignUserId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  foreignCourseId = crypto.randomUUID();
  const ownBranchId = crypto.randomUUID();
  const foreignBranchId = crypto.randomUUID();
  ownKcId = crypto.randomUUID();
  foreignKcId = crypto.randomUUID();

  await db.insert(users).values([
    { id: userId, email: `${userId}@test.local`, passwordHash: 'x' },
    { id: foreignUserId, email: `${foreignUserId}@test.local`, passwordHash: 'x' },
  ]);
  await db.insert(courses).values([
    { id: courseId, userId, code: 'OWN 101', slug: `own-${courseId}`, title: 'Owned course' },
    { id: foreignCourseId, userId: foreignUserId, code: 'OTHER 101', slug: `other-${foreignCourseId}`, title: 'Foreign course' },
  ]);
  await db.insert(branches).values([
    { id: ownBranchId, courseId, name: 'Owned branch' },
    { id: foreignBranchId, courseId: foreignCourseId, name: 'Foreign branch' },
  ]);
  await db.insert(kcs).values([
    { id: ownKcId, branchId: ownBranchId, courseId, name: 'Owned KC' },
    { id: foreignKcId, branchId: foreignBranchId, courseId: foreignCourseId, name: 'Foreign KC' },
  ]);
});

describe('rejected ownership references have no side effects', () => {
  let createdTaskCount: number;
  let createdAssessmentCount: number;

  beforeEach(async () => {
    await expect(createTask(db, userId, { title: 'Rejected task', course_ids: [foreignCourseId] })).rejects.toThrow(NotFoundError);
    await expect(
      createAssessment(db, userId, courseId, { title: 'Rejected assessment', type: 'quiz', kc_ids: [foreignKcId] }),
    ).rejects.toThrow(NotFoundError);

    createdTaskCount = (await db.select().from(tasks).where(eq(tasks.userId, userId))).length;
    createdAssessmentCount = (await db.select().from(assessments).where(eq(assessments.courseId, courseId))).length;
  });

  it.fails('does not create a task when course ownership validation rejects the request', () => {
    expect(createdTaskCount).toBe(0);
  });

  it.fails('does not create an assessment when KC ownership validation rejects the request', () => {
    expect(createdAssessmentCount).toBe(0);
  });
});

describe('rejected task link replacement is atomic', () => {
  let taskId: string;
  let observed: { title: string | undefined; done: boolean | undefined; courseIds: string[] };

  beforeEach(async () => {
    taskId = (await createTask(db, userId, { title: 'Original task', course_ids: [courseId] })).id;
    await expect(
      updateTask(db, userId, taskId, {
        title: 'Rejected partial update',
        completed: true,
        course_ids: [foreignCourseId],
      }),
    ).rejects.toThrow(NotFoundError);
    const [persistedTask] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    const links = await db.select().from(taskCourses).where(eq(taskCourses.taskId, taskId));
    observed = {
      title: persistedTask?.title,
      done: persistedTask?.done,
      courseIds: links.map((link) => link.courseId),
    };
  });

  it.fails('does not apply task fields before rejecting a foreign course reference', () => {
    expect(observed).toEqual({ title: 'Original task', done: false, courseIds: [courseId] });
  });
});

describe('rejected assessment link replacement is atomic', () => {
  let assessmentId: string;
  let observed: { title: string | undefined; gradeReceived: number | null | undefined; kcIds: string[] };

  beforeEach(async () => {
    assessmentId = (
      await createAssessment(db, userId, courseId, {
        title: 'Original assessment',
        type: 'quiz',
        kc_ids: [ownKcId],
      })
    ).id;
    await expect(
      updateAssessment(db, userId, assessmentId, {
        title: 'Rejected partial update',
        grade_received: 97,
        kc_ids: [foreignKcId],
      }),
    ).rejects.toThrow(NotFoundError);
    const [persistedAssessment] = await db.select().from(assessments).where(eq(assessments.id, assessmentId));
    const links = await db.select().from(assessmentKcs).where(eq(assessmentKcs.assessmentId, assessmentId));
    observed = {
      title: persistedAssessment?.title,
      gradeReceived: persistedAssessment?.gradeReceived,
      kcIds: links.map((link) => link.kcId),
    };
  });

  it.fails('does not apply assessment fields before rejecting a foreign KC reference', () => {
    expect(observed).toEqual({ title: 'Original assessment', gradeReceived: null, kcIds: [ownKcId] });
  });
});
