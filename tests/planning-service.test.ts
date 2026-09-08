import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, classSessions, courses, kcs, planningJobs, planningPreferences, planningRuns, sessionKcs, studySessionTiming, studySessions, taskCourses, tasks, users } from '../src/db/schema';
import { applyPlan, getPlanningPreferences, previewPlan, processPlanningJobs, undoPlan, updatePlanningPreferences } from '../src/lib/services/planning';
import { ConflictError } from '../src/lib/services/util';

const db = getDb(env.DB);
const NOW = Date.parse('2027-01-04T13:00:00.000Z'); // Monday, 08:00 Toronto
const availability = [{ day: 1, startMinute: 540, endMinute: 1020 }];
let userId: string;
let otherUserId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  otherUserId = crypto.randomUUID();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test.local`, passwordHash: 'x', timezone: 'America/Toronto' },
    { id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x', timezone: 'America/Toronto' },
  ]);
});

afterEach(async () => {
  await db.delete(planningJobs).where(eq(planningJobs.userId, userId));
  await db.delete(planningRuns).where(eq(planningRuns.userId, userId));
  await db.delete(planningPreferences).where(eq(planningPreferences.userId, userId));
});

async function enable() {
  return updatePlanningPreferences(db, userId, { enabled: true, weeklyMinutes: 420, availability, timezone: 'America/Toronto', expectedRevision: 0 }, NOW);
}

async function addTask(title = 'Read chapter') {
  const id = crypto.randomUUID();
  await db.insert(tasks).values({ id, userId, title, estimatedMinutes: 25, priority: 1 });
  return id;
}

describe('durable planning service', () => {
  it('keeps opt-in off by default and returns the learner timezone', async () => {
    await expect(previewPlan(db, userId, NOW)).rejects.toThrow(ConflictError);
    await expect(getPlanningPreferences(db, userId)).resolves.toMatchObject({ enabled: false, availability: [], revision: 0, timezone: 'America/Toronto' });
  });

  it('rejects enabled planning without an availability window even for direct service callers', async () => {
    await expect(updatePlanningPreferences(db, userId, {
      enabled: true, weeklyMinutes: 420, availability: [], timezone: 'America/Toronto', expectedRevision: 0,
    }, NOW)).rejects.toThrow(ConflictError);
  });

  it('applies a task plan atomically and undo removes only its created managed session', async () => {
    const taskId = await addTask();
    const preference = await enable();
    const preview = await previewPlan(db, userId, NOW);
    expect(preview.changes).toHaveLength(1);
    expect(preview.changes[0]).toMatchObject({ kind: 'create', taskId, before: null, after: { plannedMinutes: 25 } });

    const applied = await applyPlan(db, userId, preview.id, preference.revision, NOW + 1);
    const created = (await db.select().from(studySessions).where(eq(studySessions.id, preview.changes[0]!.sessionId)))[0];
    expect(applied).toMatchObject({ status: 'applied', appliedRevision: preference.revision + 1 });
    expect(created).toMatchObject({ taskId, managed: true, endedAt: null, plannedMinutes: 25 });

    await undoPlan(db, userId, preview.id, NOW + 2);
    expect(await db.select().from(studySessions).where(eq(studySessions.id, preview.changes[0]!.sessionId))).toEqual([]);
    expect((await db.select().from(tasks).where(eq(tasks.id, taskId)))[0]).toBeTruthy();
    expect((await db.select().from(planningRuns).where(eq(planningRuns.id, preview.id)))[0]).toMatchObject({ status: 'undone' });
  });

  it('records capacity overflow as unplaced and leaves the task unscheduled', async () => {
    const taskId = await addTask('Too large for this week');
    const preference = await updatePlanningPreferences(db, userId, {
      enabled: true, weeklyMinutes: 10, availability, timezone: 'America/Toronto', expectedRevision: 0,
    }, NOW);
    const preview = await previewPlan(db, userId, NOW);
    expect(preview.changes).toEqual([]);
    expect(preview.unplaced).toEqual([expect.objectContaining({ id: taskId, title: 'Too large for this week', reason: expect.stringContaining('Weekly study capacity') })]);
    await applyPlan(db, userId, preview.id, preference.revision, NOW + 1);
    expect(await db.select().from(studySessions).where(and(eq(studySessions.userId, userId), eq(studySessions.taskId, taskId)))).toEqual([]);
    expect((await db.select().from(tasks).where(eq(tasks.id, taskId)))[0]?.done).toBe(false);
  });

  it('marks an overflowed existing plan unscheduled and restores it on undo', async () => {
    const sessionId = crypto.randomUUID();
    const originallyScheduled = NOW + 2 * 60 * 60_000;
    await db.insert(studySessions).values({ id: sessionId, userId, intendedEventType: 'practice_done', plannedMinutes: 25, startedAt: originallyScheduled, scheduledAt: originallyScheduled });
    const preference = await updatePlanningPreferences(db, userId, {
      enabled: true, weeklyMinutes: 10, availability, timezone: 'America/Toronto', expectedRevision: 0,
    }, NOW);
    const preview = await previewPlan(db, userId, NOW);
    expect(preview.changes).toEqual([expect.objectContaining({ kind: 'update', sessionId, before: { scheduledAt: originallyScheduled, plannedMinutes: 25 }, after: null })]);
    await applyPlan(db, userId, preview.id, preference.revision, NOW + 1);
    expect((await db.select().from(studySessions).where(eq(studySessions.id, sessionId)))[0]).toMatchObject({ scheduledAt: null, planningUnscheduled: true });
    await undoPlan(db, userId, preview.id, NOW + 2);
    expect((await db.select().from(studySessions).where(eq(studySessions.id, sessionId)))[0]).toMatchObject({ scheduledAt: originallyScheduled, planningUnscheduled: false });
  });

  it('rejects stale previews and permits only one concurrent apply', async () => {
    await addTask();
    const preference = await enable();
    const preview = await previewPlan(db, userId, NOW);
    await db.update(tasks).set({ title: 'Changed source' }).where(eq(tasks.userId, userId));
    await expect(applyPlan(db, userId, preview.id, preference.revision, NOW + 1)).rejects.toThrow(ConflictError);

    const fresh = await previewPlan(db, userId, NOW + 2);
    const revision = (await db.select({ revision: planningPreferences.revision }).from(planningPreferences).where(eq(planningPreferences.userId, userId)))[0]!.revision;
    const results = await Promise.allSettled([
      applyPlan(db, userId, fresh.id, revision, NOW + 3),
      applyPlan(db, userId, fresh.id, revision, NOW + 3),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('reuses an identical immutable preview at the same revision', async () => {
    await addTask('One task, two previews');
    const preference = await enable();
    const first = await previewPlan(db, userId, NOW);
    const second = await previewPlan(db, userId, NOW);
    expect(second.id).toBe(first.id);
    expect(second.changes).toEqual(first.changes);
    const results = await Promise.allSettled([
      applyPlan(db, userId, first.id, preference.revision, NOW + 1),
      applyPlan(db, userId, second.id, preference.revision, NOW + 1),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await db.select().from(studySessions).where(eq(studySessions.userId, userId))).toHaveLength(1);
  });

  it('keeps an issued preview immutable when a later preview has different slots', async () => {
    await addTask('Immutable preview');
    const preference = await enable();
    const first = await previewPlan(db, userId, NOW);
    const firstChanges = structuredClone(first.changes);
    const second = await previewPlan(db, userId, NOW + 2 * 60 * 60_000);

    expect(second.id).not.toBe(first.id);
    expect(second.changes).not.toEqual(firstChanges);
    expect((await db.select().from(planningRuns).where(eq(planningRuns.id, first.id)))[0]?.changes).toEqual(firstChanges);

    await applyPlan(db, userId, first.id, preference.revision, NOW + 2 * 60 * 60_000 + 1);
    const firstSessionId = first.changes[0]!.sessionId;
    expect((await db.select().from(studySessions).where(eq(studySessions.id, firstSessionId)))[0]?.scheduledAt)
      .toBe(first.changes[0]!.after?.scheduledAt);
  });

  it('preserves a preference-triggered replan against a stale worker delete', async () => {
    await addTask('Queued plan');
    const enabled = await enable();
    const selectedJob = (await db.select().from(planningJobs).where(eq(planningJobs.userId, userId)))[0]!;
    const preview = await previewPlan(db, userId, NOW);
    const applied = await applyPlan(db, userId, preview.id, enabled.revision, NOW + 1);

    await updatePlanningPreferences(db, userId, {
      enabled: true,
      weeklyMinutes: 300,
      availability,
      timezone: 'America/Toronto',
      expectedRevision: applied.appliedRevision,
    }, NOW + 2);
    await db.delete(planningJobs).where(and(eq(planningJobs.userId, userId), eq(planningJobs.version, selectedJob.version)));

    const queued = (await db.select().from(planningJobs).where(eq(planningJobs.userId, userId)))[0];
    expect(queued).toMatchObject({ version: selectedJob.version + 1, attemptCount: 0, availableAt: NOW + 2 });
  });

  it('serializes concurrent timezone saves and returns the stored revision', async () => {
    const enabled = await enable();
    const results = await Promise.allSettled([
      updatePlanningPreferences(db, userId, {
        enabled: true,
        weeklyMinutes: 420,
        availability,
        timezone: 'UTC',
        expectedRevision: enabled.revision,
      }, NOW + 1),
      updatePlanningPreferences(db, userId, {
        enabled: true,
        weeklyMinutes: 420,
        availability,
        timezone: 'America/Vancouver',
        expectedRevision: enabled.revision,
      }, NOW + 1),
    ]);
    const accepted = results.filter((result) => result.status === 'fulfilled');
    expect(accepted).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    if (accepted[0]?.status !== 'fulfilled') throw new Error('Expected one accepted preference save');
    const changed = accepted[0].value;
    const stored = (await db.select().from(planningPreferences).where(eq(planningPreferences.userId, userId)))[0]!;
    expect(changed.revision).toBe(stored.revision);
    expect(changed.timezone).toBe((await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)))[0]?.timezone);

    await expect(updatePlanningPreferences(db, userId, {
      enabled: true,
      weeklyMinutes: 415,
      availability,
      timezone: changed.timezone,
      expectedRevision: changed.revision,
    }, NOW + 2)).resolves.toMatchObject({ revision: changed.revision + 1 });
  });

  it('preserves disabled consent when a worker holds a stale preview', async () => {
    const taskId = await addTask('Do not schedule after opt-out');
    const enabled = await enable();
    const preview = await previewPlan(db, userId, NOW);

    const disabled = await updatePlanningPreferences(db, userId, {
      enabled: false,
      weeklyMinutes: 420,
      availability,
      timezone: 'America/Toronto',
      expectedRevision: enabled.revision,
    }, NOW + 1);

    await expect(applyPlan(db, userId, preview.id, preview.sourceRevision, NOW + 2)).rejects.toThrow(ConflictError);
    await expect(getPlanningPreferences(db, userId)).resolves.toMatchObject({ enabled: false, revision: disabled.revision });
    expect(await db.select().from(studySessions).where(and(eq(studySessions.userId, userId), eq(studySessions.taskId, taskId)))).toEqual([]);
    expect(await db.select().from(planningJobs).where(eq(planningJobs.userId, userId))).toEqual([]);
  });

  it('normalizes a nullable session duration through apply and undo', async () => {
    const sessionId = crypto.randomUUID();
    const original = NOW + 4 * 60 * 60_000;
    await db.insert(studySessions).values({
      id: sessionId,
      userId,
      intendedEventType: 'practice_done',
      plannedMinutes: null,
      startedAt: original,
      scheduledAt: original,
    });
    const preference = await enable();
    const preview = await previewPlan(db, userId, NOW);
    expect(preview.changes).toEqual([expect.objectContaining({
      kind: 'update',
      sessionId,
      before: { scheduledAt: original, plannedMinutes: 25 },
      after: expect.objectContaining({ plannedMinutes: 25 }),
    })]);

    await applyPlan(db, userId, preview.id, preference.revision, NOW + 1);
    expect((await db.select().from(studySessions).where(eq(studySessions.id, sessionId)))[0]?.plannedMinutes).toBe(25);
    await undoPlan(db, userId, preview.id, NOW + 2);
    expect((await db.select().from(studySessions).where(eq(studySessions.id, sessionId)))[0]).toMatchObject({
      scheduledAt: original,
      plannedMinutes: 25,
    });
  });

  it('blocks the remaining duration of an active unscheduled session', async () => {
    const sessionId = crypto.randomUUID();
    await db.insert(studySessions).values({
      id: sessionId,
      userId,
      intendedEventType: 'practice_done',
      plannedMinutes: 30,
      startedAt: NOW - 5 * 60_000,
      scheduledAt: null,
    });
    await db.insert(studySessionTiming).values({
      sessionId,
      userId,
      state: 'running',
      elapsedMs: 5 * 60_000,
      deviceId: 'active-device',
      leaseToken: crypto.randomUUID(),
      lastAckAt: NOW,
      leaseExpiresAt: NOW + 45_000,
      sequence: 1,
      revision: 1,
      updatedAt: NOW,
    });
    const taskId = await addTask('After active study');
    await updatePlanningPreferences(db, userId, {
      enabled: true,
      weeklyMinutes: 60,
      availability: [{ day: 1, startMinute: 480, endMinute: 600 }],
      timezone: 'America/Toronto',
      expectedRevision: 0,
    }, NOW);

    const preview = await previewPlan(db, userId, NOW);
    const change = preview.changes.find((item) => item.kind === 'create' && item.taskId === taskId)!;
    expect(change.after?.scheduledAt).toBeGreaterThanOrEqual(NOW + 25 * 60_000);
  });

  it('retains a represented task deadline and priority while moving its session', async () => {
    const representedTaskId = crypto.randomUUID();
    const competingTaskId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    await db.insert(tasks).values([
      { id: representedTaskId, userId, title: 'Due first', estimatedMinutes: 25, priority: 2, dueDate: NOW + 25 * 60_000 },
      { id: competingTaskId, userId, title: 'Can follow', estimatedMinutes: 25, priority: 2 },
    ]);
    await db.insert(studySessions).values({
      id: sessionId,
      userId,
      taskId: representedTaskId,
      intendedEventType: 'practice_done',
      plannedMinutes: 25,
      startedAt: NOW - 60 * 60_000,
      scheduledAt: NOW - 60 * 60_000,
    });
    await updatePlanningPreferences(db, userId, {
      enabled: true,
      weeklyMinutes: 60,
      availability: [{ day: 1, startMinute: 480, endMinute: 540 }],
      timezone: 'America/Toronto',
      expectedRevision: 0,
    }, NOW);

    const preview = await previewPlan(db, userId, NOW);
    expect(preview.changes.find((item) => item.sessionId === sessionId)?.after?.scheduledAt).toBe(NOW);
    expect(preview.changes.find((item) => item.kind === 'create' && item.taskId === competingTaskId)?.after?.scheduledAt)
      .toBe(NOW + 25 * 60_000);
  });

  it('carries a system KC task course and KC provenance into its managed session', async () => {
    const courseId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const kcId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await db.insert(courses).values({ id: courseId, userId, code: 'PLAN101', slug: `plan-${courseId}`, title: 'Planning' });
    await db.insert(branches).values({ id: branchId, courseId, name: 'Core' });
    await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Target', kcType: 'fact' });
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: 'Practice target',
      type: 'practice_kc',
      source: 'system',
      courseId,
      kcId,
      estimatedMinutes: 25,
    });
    const preference = await enable();
    const preview = await previewPlan(db, userId, NOW);
    await applyPlan(db, userId, preview.id, preference.revision, NOW + 1);
    const sessionId = preview.changes.find((change) => change.kind === 'create' && change.taskId === taskId)!.sessionId;

    expect((await db.select().from(studySessions).where(eq(studySessions.id, sessionId)))[0]).toMatchObject({ courseId, taskId });
    expect(await db.select().from(sessionKcs).where(eq(sessionKcs.studySessionId, sessionId)))
      .toEqual([expect.objectContaining({ kcId })]);
    await undoPlan(db, userId, preview.id, NOW + 2);
    expect(await db.select().from(sessionKcs).where(eq(sessionKcs.studySessionId, sessionId))).toEqual([]);
  });

  it('invalidates a preview when only a user task course relation changes', async () => {
    const firstCourseId = crypto.randomUUID();
    const secondCourseId = crypto.randomUUID();
    await db.insert(courses).values([
      { id: firstCourseId, userId, code: 'ONE', slug: `one-${firstCourseId}`, title: 'One' },
      { id: secondCourseId, userId, code: 'TWO', slug: `two-${secondCourseId}`, title: 'Two' },
    ]);
    const taskId = await addTask('Course-linked task');
    await db.insert(taskCourses).values({ id: crypto.randomUUID(), taskId, courseId: firstCourseId });
    const preference = await enable();
    const preview = await previewPlan(db, userId, NOW);
    expect(preview.changes).toEqual([expect.objectContaining({ kind: 'create', taskId, courseId: firstCourseId })]);

    await db.delete(taskCourses).where(and(eq(taskCourses.taskId, taskId), eq(taskCourses.courseId, firstCourseId)));
    await db.insert(taskCourses).values({ id: crypto.randomUUID(), taskId, courseId: secondCourseId });

    await expect(applyPlan(db, userId, preview.id, preference.revision, NOW + 1)).rejects.toThrow(ConflictError);
    const queued = (await db.select().from(planningJobs).where(eq(planningJobs.userId, userId)))[0];
    expect(queued).toBeTruthy();

    const fresh = await previewPlan(db, userId, NOW + 2);
    await applyPlan(db, userId, fresh.id, fresh.sourceRevision, NOW + 3);
    const createdSessionId = fresh.changes.find((change) => change.kind === 'create' && change.taskId === taskId)!.sessionId;
    expect((await db.select().from(studySessions).where(eq(studySessions.id, createdSessionId)))[0]?.courseId).toBe(secondCourseId);
  });

  it('moves only unlocked planned sessions and preserves their ownership and duration', async () => {
    const movableId = crypto.randomUUID();
    const lockedId = crypto.randomUUID();
    const runningId = crypto.randomUUID();
    const endedId = crypto.randomUUID();
    const at = NOW + 4 * 60 * 60_000;
    await db.insert(studySessions).values([
      { id: movableId, userId, intendedEventType: 'practice_done', plannedMinutes: 30, startedAt: at, scheduledAt: at, managed: false },
      { id: lockedId, userId, intendedEventType: 'practice_done', plannedMinutes: 30, startedAt: at + 60_000, scheduledAt: at + 60_000, locked: true },
      { id: runningId, userId, intendedEventType: 'practice_done', plannedMinutes: 30, startedAt: at + 120_000, scheduledAt: at + 120_000 },
      { id: endedId, userId, intendedEventType: 'practice_done', plannedMinutes: 30, startedAt: at, scheduledAt: at, endedAt: at + 30 * 60_000 },
    ]);
    await db.insert(studySessionTiming).values({ sessionId: runningId, userId, state: 'running', elapsedMs: 0, deviceId: 'device-a', leaseToken: crypto.randomUUID(), lastAckAt: NOW, leaseExpiresAt: NOW + 45_000, sequence: 0, revision: 0, updatedAt: NOW });
    const preference = await enable();
    const preview = await previewPlan(db, userId, NOW);
    expect(preview.changes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'update', sessionId: movableId, before: { scheduledAt: at, plannedMinutes: 30 }, after: expect.objectContaining({ plannedMinutes: 30 }) })]));
    expect(preview.changes.find((change) => change.sessionId === lockedId)).toBeUndefined();
    expect(preview.changes.find((change) => change.sessionId === runningId)).toBeUndefined();
    await applyPlan(db, userId, preview.id, preference.revision, NOW + 1);
    expect((await db.select().from(studySessions).where(eq(studySessions.id, movableId)))[0]).toMatchObject({ managed: false, plannedMinutes: 30 });
    expect((await db.select().from(studySessions).where(eq(studySessions.id, lockedId)))[0]?.scheduledAt).toBe(at + 60_000);
  });

  it('counts fixed locked study against weekly capacity', async () => {
    const lockedId = crypto.randomUUID();
    const at = NOW + 2 * 60 * 60_000;
    await db.insert(studySessions).values({ id: lockedId, userId, intendedEventType: 'practice_done', plannedMinutes: 25, startedAt: at, scheduledAt: at, locked: true });
    const taskId = await addTask('Cannot fit after lock');
    await db.update(tasks).set({ dueDate: NOW + 8 * 60 * 60_000 }).where(eq(tasks.id, taskId));
    await updatePlanningPreferences(db, userId, { enabled: true, weeklyMinutes: 25, availability, timezone: 'America/Toronto', expectedRevision: 0 }, NOW);
    const preview = await previewPlan(db, userId, NOW);
    expect(preview.unplaced).toEqual(expect.arrayContaining([expect.objectContaining({ id: taskId, reason: expect.any(String) })]));
  });

  it('does not undo after a source revision changes and applies due opt-in jobs automatically', async () => {
    await addTask('Automatic plan');
    const preference = await enable();
    expect(await db.select().from(planningJobs).where(eq(planningJobs.userId, userId))).toHaveLength(1);
    await expect(processPlanningJobs(db, { now: NOW, limit: 10 })).resolves.toMatchObject({ processed: expect.any(Number) });
    const applied = (await db.select().from(planningRuns).where(and(eq(planningRuns.userId, userId), eq(planningRuns.status, 'applied'))))[0]!;
    expect(await db.select().from(planningJobs).where(eq(planningJobs.userId, userId))).toEqual([]);
    await db.update(tasks).set({ priority: 2 }).where(eq(tasks.userId, userId));
    await expect(undoPlan(db, userId, applied.id, NOW + 1)).rejects.toThrow(ConflictError);
    expect(applied.appliedRevision).toBe(preference.revision + 1);
  });

  it('uses a class local wall time as busy time across timezone conversion', async () => {
    const taskId = await addTask('After class');
    const courseId = crypto.randomUUID();
    await db.insert(courses).values({ id: courseId, userId, code: 'DST101', slug: `dst-${courseId}`, title: 'DST' });
    // Local Monday noon and a 09:00–10:00 class. Planner begins at 08:00.
    await db.insert(classSessions).values({ id: crypto.randomUUID(), userId, courseId, date: Date.parse('2027-01-04T17:00:00.000Z'), startMin: 540, endMin: 600, source: 'manual' });
    await enable();
    const preview = await previewPlan(db, userId, NOW);
    const change = preview.changes.find((item) => item.kind === 'create' && item.taskId === taskId)!;
    expect(change.after?.scheduledAt).toBeGreaterThanOrEqual(Date.parse('2027-01-04T15:00:00.000Z'));
  });
});
