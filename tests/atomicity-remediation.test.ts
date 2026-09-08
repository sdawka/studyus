import { env } from 'cloudflare:test';
import { eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import {
  assessmentKcs,
  assessments,
  branches,
  courses,
  events,
  kcs,
  notifications,
  taskCourses,
  tasks,
  users,
  studySessions,
} from '../src/db/schema';
import { createAssessment, updateAssessment } from '../src/lib/services/assessments';
import { createTask, updateTask } from '../src/lib/services/tasks';
import { createEvent } from '../src/lib/services/events';
import { foldMastery } from '../src/lib/services/mastery';
import { completeSession, createSession } from '../src/lib/services/sessions';
import { ConflictError } from '../src/lib/services/util';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let replacementCourseId: string;
let kcId: string;
let replacementKcId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  replacementCourseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  kcId = crypto.randomUUID();
  replacementKcId = crypto.randomUUID();

  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values([
    { id: courseId, userId, code: 'OWN 101', slug: `own-${courseId}`, title: 'Owned course' },
    {
      id: replacementCourseId,
      userId,
      code: 'OWN 102',
      slug: `own-${replacementCourseId}`,
      title: 'Replacement course',
    },
  ]);
  await db.insert(branches).values({ id: branchId, courseId, name: 'Owned branch' });
  await db.insert(kcs).values([
    { id: kcId, branchId, courseId, name: 'Original KC' },
    { id: replacementKcId, branchId, courseId, name: 'Replacement KC' },
  ]);
});

async function withFailureTrigger(name: string, sql: string, operation: () => Promise<unknown>) {
  await env.DB.prepare(sql).run();
  try {
    await expect(operation()).rejects.toThrow();
  } finally {
    await env.DB.prepare(`DROP TRIGGER IF EXISTS ${name}`).run();
  }
}

describe('task persistence atomicity', () => {
  it('rolls the task parent row back when a course-link insert fails', async () => {
    await withFailureTrigger(
      'fail_task_course_create',
      `CREATE TRIGGER fail_task_course_create
       BEFORE INSERT ON task_courses
       BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END`,
      () => createTask(db, userId, { title: 'Atomic task', course_ids: [courseId] }),
    );

    expect(await db.select().from(tasks).where(eq(tasks.userId, userId))).toHaveLength(0);
    expect(await db.select().from(taskCourses)).toHaveLength(0);
  });

  it('rolls task fields and existing links back when replacement-link persistence fails', async () => {
    const taskId = (await createTask(db, userId, { title: 'Original task', course_ids: [courseId] })).id;

    await withFailureTrigger(
      'fail_task_course_replace',
      `CREATE TRIGGER fail_task_course_replace
       BEFORE INSERT ON task_courses
       BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END`,
      () =>
        updateTask(db, userId, taskId, {
          title: 'Changed task',
          completed: true,
          course_ids: [replacementCourseId],
        }),
    );

    const [storedTask] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    const links = await db.select().from(taskCourses).where(eq(taskCourses.taskId, taskId));
    expect(storedTask).toMatchObject({ title: 'Original task', done: false, completedAt: null });
    expect(links.map((link) => link.courseId)).toEqual([courseId]);
  });
});

describe('assessment persistence atomicity', () => {
  it('rolls the assessment parent row back when a KC-link insert fails', async () => {
    await withFailureTrigger(
      'fail_assessment_kc_create',
      `CREATE TRIGGER fail_assessment_kc_create
       BEFORE INSERT ON assessment_kcs
       BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END`,
      () => createAssessment(db, userId, courseId, { title: 'Atomic assessment', type: 'quiz', kc_ids: [kcId] }),
    );

    expect(await db.select().from(assessments).where(eq(assessments.courseId, courseId))).toHaveLength(0);
    expect(await db.select().from(assessmentKcs)).toHaveLength(0);
  });

  it('increments the server revision for field-only and link-only updates', async () => {
    const created = await createAssessment(db, userId, courseId, {
      title: 'Revisioned assessment',
      type: 'quiz',
      kc_ids: [kcId],
    });
    expect(created.revision).toBe(0);

    const fieldUpdate = await updateAssessment(db, userId, created.id, { title: 'Renamed assessment' });
    expect(fieldUpdate.assessment?.revision).toBe(1);

    const linkUpdate = await updateAssessment(db, userId, created.id, { kc_ids: [replacementKcId] });
    expect(linkUpdate.assessment?.revision).toBe(2);
    expect(linkUpdate.assessment?.kcIds).toEqual([replacementKcId]);
  });

  it('does not translate an unrelated D1 failure into a revision conflict', async () => {
    const assessment = await createAssessment(db, userId, courseId, {
      title: 'Persistence error assessment',
      type: 'quiz',
    });
    let rejection: unknown;
    await env.DB.prepare(
      `CREATE TRIGGER fail_assessment_update
       BEFORE UPDATE ON assessments
       BEGIN SELECT RAISE(ABORT, 'injected unrelated failure'); END`,
    ).run();
    try {
      await updateAssessment(db, userId, assessment.id, { title: 'Must not persist' });
    } catch (error) {
      rejection = error;
    } finally {
      await env.DB.prepare('DROP TRIGGER IF EXISTS fail_assessment_update').run();
    }

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).not.toBeInstanceOf(ConflictError);
    const [stored] = await db.select().from(assessments).where(eq(assessments.id, assessment.id));
    expect(stored).toMatchObject({ title: 'Persistence error assessment', revision: 0 });
  });

  async function expectRejectedGradeUpdateLeavesNoSideEffects(triggerName: string, triggerSql: string) {
    const assessmentId = (
      await createAssessment(db, userId, courseId, {
        title: 'Original assessment',
        type: 'quiz',
        kc_ids: [kcId],
      })
    ).id;
    const gradeTaskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: gradeTaskId,
      userId,
      title: 'Enter grade',
      type: 'grade_entry',
      assessmentId,
      dedupeKey: `grade_entry:${assessmentId}`,
    });

    await withFailureTrigger(triggerName, triggerSql, () =>
      updateAssessment(db, userId, assessmentId, {
        title: 'Changed assessment',
        grade_received: 90,
        grade_max: 100,
        kc_ids: [replacementKcId],
      }),
    );

    const [storedAssessment] = await db.select().from(assessments).where(eq(assessments.id, assessmentId));
    const links = await db.select().from(assessmentKcs).where(eq(assessmentKcs.assessmentId, assessmentId));
    const storedEvents = await db.select().from(events).where(eq(events.userId, userId));
    const storedNotifications = await db.select().from(notifications).where(eq(notifications.userId, userId));
    const [gradeTask] = await db.select().from(tasks).where(eq(tasks.id, gradeTaskId));
    const storedKcs = await db.select().from(kcs).where(inArray(kcs.id, [kcId, replacementKcId]));

    expect(storedAssessment).toMatchObject({ title: 'Original assessment', gradeReceived: null, gradeMax: null });
    expect(links.map((link) => link.kcId)).toEqual([kcId]);
    expect(storedEvents).toHaveLength(0);
    expect(storedNotifications).toHaveLength(0);
    expect(gradeTask).toMatchObject({ done: false, completedAt: null });
    expect(storedKcs).toHaveLength(2);
    expect(storedKcs.every((kc) => kc.mastery === 0 && kc.status === 'not-started' && kc.lastEventAt === null)).toBe(true);
  }

  it('rolls grade, links, events, mastery, and notification back when grade-task persistence fails', async () => {
    await expectRejectedGradeUpdateLeavesNoSideEffects(
      'fail_grade_task_update',
      `CREATE TRIGGER fail_grade_task_update
       BEFORE UPDATE OF done ON tasks
       WHEN OLD.type = 'grade_entry'
       BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END`,
    );
  });

  it('rolls grade, links, events, mastery, and task completion back when notification persistence fails', async () => {
    await expectRejectedGradeUpdateLeavesNoSideEffects(
      'fail_grade_notification_insert',
      `CREATE TRIGGER fail_grade_notification_insert
       BEFORE INSERT ON notifications
       WHEN NEW.type = 'grade_recorded'
       BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END`,
    );
  });

  it('rolls grade, links, event insertion, notification, and task completion back when mastery persistence fails', async () => {
    await expectRejectedGradeUpdateLeavesNoSideEffects(
      'fail_grade_mastery_update',
      `CREATE TRIGGER fail_grade_mastery_update
       BEFORE UPDATE OF mastery ON kcs
      BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END`,
    );
  });

  it('keeps a concurrent linked-KC grade update to one consistent evidence write', async () => {
    const assessmentId = (
      await createAssessment(db, userId, courseId, {
        title: 'Concurrent assessment',
        type: 'quiz',
        kc_ids: [kcId],
      })
    ).id;
    const gradeTaskId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: gradeTaskId,
      userId,
      title: 'Enter concurrent grade',
      type: 'grade_entry',
      assessmentId,
      dedupeKey: `grade_entry:${assessmentId}`,
    });

    const input = {
      title: 'Concurrent assessment graded',
      grade_received: 90,
      grade_max: 100,
      kc_ids: [replacementKcId],
    };
    const outcomes = await Promise.allSettled([
      updateAssessment(db, userId, assessmentId, input),
      updateAssessment(db, userId, assessmentId, input),
      updateAssessment(db, userId, assessmentId, input),
      updateAssessment(db, userId, assessmentId, input),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(rejected.every((outcome) => outcome.reason instanceof ConflictError)).toBe(true);

    const [storedAssessment] = await db.select().from(assessments).where(eq(assessments.id, assessmentId));
    const links = await db.select().from(assessmentKcs).where(eq(assessmentKcs.assessmentId, assessmentId));
    const storedEvents = await db.select().from(events).where(eq(events.userId, userId));
    const storedNotifications = await db.select().from(notifications).where(eq(notifications.userId, userId));
    const [gradeTask] = await db.select().from(tasks).where(eq(tasks.id, gradeTaskId));
    const storedKcs = await db.select().from(kcs).where(inArray(kcs.id, [kcId, replacementKcId]));
    const originalKc = storedKcs.find((kc) => kc.id === kcId);
    const replacementKc = storedKcs.find((kc) => kc.id === replacementKcId);

    expect(storedAssessment).toMatchObject({
      title: 'Concurrent assessment graded',
      gradeReceived: 90,
      gradeMax: 100,
      revision: fulfilled.length,
    });
    expect(links.map((link) => link.kcId)).toEqual([replacementKcId]);
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0]).toMatchObject({ kcId: replacementKcId, payload: { score: 90, assessment_id: assessmentId } });
    expect(storedNotifications).toHaveLength(1);
    expect(gradeTask).toMatchObject({ done: true });
    expect(originalKc).toMatchObject({ mastery: 0, status: 'not-started', lastEventAt: null });
    expect(replacementKc?.mastery).toBeGreaterThan(0);
    expect(replacementKc?.lastEventAt).toBe(storedEvents[0].ts);
  });

  it('refolds every distinct concurrent assessment event into the shared KC cache', async () => {
    const rows = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      createAssessment(db, userId, courseId, { title: `Concurrent ${index}`, type: 'quiz', kc_ids: [kcId] }),
    ));
    await Promise.all(rows.map((assessment, index) =>
      updateAssessment(db, userId, assessment.id, { grade_received: 60 + index, grade_max: 100 }),
    ));

    const storedEvents = await db.select().from(events).where(eq(events.kcId, kcId));
    const expected = foldMastery(storedEvents);
    const storedKc = (await db.select().from(kcs).where(eq(kcs.id, kcId)))[0];
    expect(storedEvents).toHaveLength(8);
    expect(storedKc).toMatchObject({ mastery: expected.mastery, status: expected.status, lastEventAt: expected.lastEventAt, revision: 8 });
  });

  it('rolls the whole evidence batch back when the owner becomes inactive after preflight', async () => {
    const assessment = await createAssessment(db, userId, courseId, { title: 'Fence race', type: 'quiz', kc_ids: [kcId] });
    await env.DB.prepare(`
      CREATE TRIGGER flip_owner_during_assessment_update
      BEFORE UPDATE ON assessments WHEN OLD.id = '${assessment.id}'
      BEGIN UPDATE users SET account_state = 'deleting' WHERE id = '${userId}'; END
    `).run();
    try {
      await expect(updateAssessment(db, userId, assessment.id, { grade_received: 88, grade_max: 100 })).rejects.toThrow('inactive account');
    } finally {
      await env.DB.prepare('DROP TRIGGER IF EXISTS flip_owner_during_assessment_update').run();
    }

    expect((await db.select().from(users).where(eq(users.id, userId)))[0].accountState).toBe('active');
    expect((await db.select().from(assessments).where(eq(assessments.id, assessment.id)))[0]).toMatchObject({ gradeReceived: null, revision: 0 });
    expect(await db.select().from(events).where(eq(events.userId, userId))).toEqual([]);
    expect(await db.select().from(notifications).where(eq(notifications.userId, userId))).toEqual([]);
    expect((await db.select().from(kcs).where(eq(kcs.id, kcId)))[0]).toMatchObject({ mastery: 0, revision: 0 });
  });
});

describe('account deletion source fences', () => {
  it('rejects task, assessment, event, and session writes for an inactive source user', async () => {
    const assessment = await createAssessment(db, userId, courseId, { title: 'Before deletion', type: 'quiz', kc_ids: [kcId] });
    const task = await createTask(db, userId, { title: 'Before deletion', course_ids: [courseId] });
    const session = await createSession(db, userId, { intended_event_type: 'practice_done', course_id: courseId, kc_ids: [kcId] });
    await db.update(users).set({ accountState: 'deleting' }).where(eq(users.id, userId));

    await expect(createTask(db, userId, { title: 'After deletion' })).rejects.toThrow();
    await expect(updateTask(db, userId, task.id, { title: 'After deletion' })).rejects.toThrow();
    await expect(updateAssessment(db, userId, assessment.id, { grade_received: 90, grade_max: 100 })).rejects.toThrow();
    await expect(createEvent(db, userId, { type: 'practice_done', kc_id: kcId, course_id: courseId })).rejects.toThrow();
    await expect(completeSession(db, userId, session.id, { kc_outcomes: [{ kc_id: kcId }] })).rejects.toThrow();

    expect(await db.select().from(events).where(eq(events.userId, userId))).toEqual([]);
    expect((await db.select().from(assessments).where(eq(assessments.id, assessment.id)))[0].gradeReceived).toBeNull();
    expect((await db.select().from(tasks).where(eq(tasks.id, task.id)))[0].title).toBe('Before deletion');
    expect((await db.select().from(studySessions).where(eq(studySessions.id, session.id)))[0].endedAt).toBeNull();
  });
});

describe('event cache CAS', () => {
  it('retries distinct concurrent direct event writes against one KC', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) => createEvent(db, userId, {
      type: 'quiz_taken',
      kc_id: kcId,
      course_id: courseId,
      payload: { score: 70 + index },
    })));
    const storedEvents = await db.select().from(events).where(eq(events.kcId, kcId));
    const expected = foldMastery(storedEvents);
    const storedKc = (await db.select().from(kcs).where(eq(kcs.id, kcId)))[0];
    expect(storedEvents).toHaveLength(8);
    expect(storedKc).toMatchObject({ mastery: expected.mastery, status: expected.status, lastEventAt: expected.lastEventAt, revision: 8 });
  });
});
