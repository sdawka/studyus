import { and, asc, desc, eq, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Db } from '../../db/client';
import { calendarConnections, calendarExternalEvents, calendarOutbox, calendarProviderCalendars, classSessions, planningJobs, planningPreferences, planningRuns, sessionKcs, studySessionTiming, studySessions, taskCourses, tasks, users } from '../../db/schema';
import { schedulePlan, zonedClock, type Availability } from '../planning/engine';
import { ConflictError, NotFoundError, runBatch } from './util';
import { listAcceptedGroupEvents } from './groups';

type Slot = { scheduledAt: number; plannedMinutes: number };
type CreateChange = { kind: 'create'; sessionId: string; taskId: string; courseId: string | null; kcId: string | null; title: string; before: null; after: Slot; reason: string };
type UpdateChange = { kind: 'update'; sessionId: string; title: string; before: Slot | null; after: Slot | null; reason: string };
type Change = CreateChange | UpdateChange;
type Unplaced = { id: string; title: string; reason: string };
const HOUR = 60 * 60_000;
const PLANNING_JOB_LEASE_MS = 5 * 60_000;

async function requireActiveUser(db: Db, userId: string) {
  const user = (await db.select({ id: users.id, timezone: users.timezone }).from(users)
    .where(and(eq(users.id, userId), eq(users.accountState, 'active'))).limit(1))[0];
  if (!user) throw new NotFoundError('Planning preferences');
  return user;
}

/** Class dates are retained as local noon. Find the matching local wall minute
 * instead of treating that value as a UTC date; this also respects DST. */
function wallInstant(localNoon: number, minute: number, timezone: string) {
  const date = new Date(localNoon).toISOString().slice(0, 10);
  for (let time = localNoon - 18 * HOUR; time <= localNoon + 18 * HOUR; time += 60_000) {
    const clock = zonedClock(time, timezone);
    if (clock.date === date && clock.minute === minute) return time;
  }
  return null;
}

function dateInstant(date: string, minute: number, timezone: string) {
  const noon = Date.parse(`${date}T12:00:00.000Z`);
  for (let time = noon - 18 * HOUR; time <= noon + 18 * HOUR; time += 60_000) {
    const clock = zonedClock(time, timezone);
    if (clock.date === date && clock.minute === minute) return time;
  }
  return null;
}

function nextDate(date: string) { return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10); }

function defaultPreferences(userId: string) {
  return { userId, enabled: false, weeklyMinutes: 420, availability: [] as Availability[], revision: 0, applying: false, updatedAt: 0 };
}

function changeReason(reasons: string[]) { return reasons.join(', ') || 'Available study time'; }

function comparableChanges(changes: Change[]) {
  return changes.map((change) => change.kind === 'create'
    ? { ...change, sessionId: `task:${change.taskId}` }
    : change);
}

function samePreviewContent(prior: { changes: unknown; unplaced: unknown }, changes: Change[], unplaced: Unplaced[]) {
  return JSON.stringify({ changes: comparableChanges(prior.changes as Change[]), unplaced: prior.unplaced })
    === JSON.stringify({ changes: comparableChanges(changes), unplaced });
}

export async function getPlanningPreferences(db: Db, userId: string) {
  const user = await requireActiveUser(db, userId);
  const preference = (await db.select().from(planningPreferences).where(eq(planningPreferences.userId, userId)).limit(1))[0] ?? defaultPreferences(userId);
  return { enabled: preference.enabled, weeklyMinutes: preference.weeklyMinutes, availability: preference.availability, revision: preference.revision, timezone: user.timezone };
}

export async function updatePlanningPreferences(
  db: Db, userId: string,
  input: { enabled: boolean; weeklyMinutes: number; availability: Availability[]; timezone: string; expectedRevision: number }, now = Date.now(),
) {
  await requireActiveUser(db, userId);
  if (input.enabled && input.availability.length === 0) throw new ConflictError('Add a study window before enabling automatic planning');
  if (input.expectedRevision !== 0) {
    const existing = (await db.select({ id: planningPreferences.userId }).from(planningPreferences).where(eq(planningPreferences.userId, userId)).limit(1))[0];
    if (!existing) throw new ConflictError('Planning preferences changed');
  }
  const nextRevision = input.expectedRevision + 1;
  try {
    await runBatch(db, [
      db.insert(planningPreferences).values({ userId, enabled: input.enabled, weeklyMinutes: input.weeklyMinutes, availability: input.availability, revision: nextRevision, applying: true, updatedAt: now })
        .onConflictDoUpdate({ target: planningPreferences.userId, set: {
          enabled: input.enabled, weeklyMinutes: input.weeklyMinutes, availability: input.availability, applying: true, updatedAt: now,
          revision: sql`CASE WHEN ${planningPreferences.revision} = ${input.expectedRevision} AND ${planningPreferences.applying} = 0 THEN ${nextRevision} ELSE -1 END`,
        } }),
      db.update(users).set({ timezone: input.timezone }).where(and(eq(users.id, userId), eq(users.accountState, 'active'))),
      input.enabled && input.availability.length
        ? db.insert(planningJobs).values({ userId, availableAt: now, requestedAt: now }).onConflictDoUpdate({ target: planningJobs.userId, set: { availableAt: now, requestedAt: now, version: sql`${planningJobs.version} + 1`, attemptCount: 0 } })
        : db.delete(planningJobs).where(eq(planningJobs.userId, userId)),
      db.update(planningPreferences).set({ applying: false, updatedAt: now }).where(and(eq(planningPreferences.userId, userId), eq(planningPreferences.revision, nextRevision), eq(planningPreferences.applying, true))),
    ]);
  } catch { throw new ConflictError('Planning preferences changed'); }
  return { enabled: input.enabled, weeklyMinutes: input.weeklyMinutes, availability: input.availability, revision: nextRevision, timezone: input.timezone };
}

export async function previewPlan(db: Db, userId: string, now = Date.now()) {
  const user = await requireActiveUser(db, userId);
  const preference = await getPlanningPreferences(db, userId);
  if (!preference.enabled) throw new ConflictError('Automatic planning is disabled');
  if (!preference.availability.length) throw new ConflictError('Set study availability before planning');
  const existing = await db.select({ session: studySessions, timing: studySessionTiming }).from(studySessions)
    .leftJoin(studySessionTiming, eq(studySessionTiming.sessionId, studySessions.id)).where(eq(studySessions.userId, userId));
  // Include missed plans: the former scheduled time is not a deadline.
  const movable = existing.filter(({ session, timing }) => session.endedAt === null && (session.scheduledAt !== null || session.planningUnscheduled) && !session.locked && timing?.state !== 'running');
  const movableIds = new Set(movable.map(({ session }) => session.id));
  const representedTaskIds = new Set(existing.filter(({ session }) => session.endedAt === null && session.taskId !== null).map(({ session }) => session.taskId!));
  const taskRows = await db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.done, false), isNull(tasks.dismissedAt), ne(tasks.type, 'attend_class'), ne(tasks.type, 'grade_entry')));
  const taskCourseRows = taskRows.length
    ? await db.select({ taskId: taskCourses.taskId, courseId: taskCourses.courseId }).from(taskCourses).where(inArray(taskCourses.taskId, taskRows.map((task) => task.id)))
    : [];
  const courseIdsByTask = new Map<string, string[]>();
  for (const link of taskCourseRows) {
    const ids = courseIdsByTask.get(link.taskId) ?? [];
    ids.push(link.courseId);
    courseIdsByTask.set(link.taskId, ids);
  }
  const taskById = new Map(taskRows.map((task) => [task.id, task]));
  const taskTitles = new Map(taskRows.map((task) => [task.id, task.title]));
  const items = [
    ...movable.map(({ session }) => {
      const task = session.taskId ? taskById.get(session.taskId) : undefined;
      return { id: `s:${session.id}`, minutes: session.plannedMinutes ?? 25, priority: task?.priority ?? 1, deadline: task?.dueDate, title: task?.title ?? (session.taskId ? 'Planned task study' : 'Study session') };
    }),
    ...taskRows.filter((task) => !representedTaskIds.has(task.id)).map((task) => ({ id: `t:${task.id}`, minutes: task.estimatedMinutes, deadline: task.dueDate, priority: task.priority, title: task.title })),
  ];
  const fixedStudy = existing.filter(({ session }) => !movableIds.has(session.id) && session.endedAt === null)
    .flatMap(({ session, timing }) => {
      const duration = (session.plannedMinutes ?? 25) * 60_000;
      if (timing?.state === 'running') {
        const elapsed = Math.min(duration, Math.max(0, timing.elapsedMs));
        return [{ start: now - elapsed, end: now + duration - elapsed }];
      }
      return session.scheduledAt === null ? [] : [{ start: session.scheduledAt, end: session.scheduledAt + duration }];
    });
  const busy = [...fixedStudy];
  const external = await db.select({ event: calendarExternalEvents }).from(calendarExternalEvents)
    .innerJoin(calendarProviderCalendars, eq(calendarExternalEvents.providerCalendarId, calendarProviderCalendars.id))
    .where(and(eq(calendarExternalEvents.userId, userId), eq(calendarExternalEvents.status, 'confirmed'), eq(calendarProviderCalendars.selected, true), ne(calendarExternalEvents.busyStatus, 'free')));
  for (const { event } of external) {
    if (event.startAt !== null) busy.push({ start: event.startAt, end: event.endAt ?? event.startAt });
    else if (event.startKind === 'date' && event.startDate) {
      const start = dateInstant(event.startDate, 0, user.timezone);
      const end = dateInstant(event.endDate ?? nextDate(event.startDate), 0, user.timezone);
      if (start !== null && end !== null && end > start) busy.push({ start, end });
    }
  }
  const classes = await db.select().from(classSessions).where(eq(classSessions.userId, userId));
  for (const session of classes) {
    if (session.startMin === null || session.endMin === null) continue;
    const start = wallInstant(session.date, session.startMin, user.timezone);
    const end = wallInstant(session.date, session.endMin, user.timezone);
    if (start !== null && end !== null && end > start) busy.push({ start, end });
  }
  for (const event of await listAcceptedGroupEvents(db,userId,now,now+14*86_400_000)) busy.push({start:event.startsAt,end:event.endsAt});
  const planned = schedulePlan({ now, timezone: user.timezone, availability: preference.availability, weeklyMinutes: preference.weeklyMinutes, items, busy, committedStudy: fixedStudy });
  const changes: Change[] = planned.scheduled.map((scheduled) => {
    const reason = changeReason(scheduled.reasons);
    if (scheduled.id.startsWith('t:')) {
      const taskId = scheduled.id.slice(2);
      const task = taskById.get(taskId);
      const linkedCourseIds = courseIdsByTask.get(taskId) ?? [];
      const courseId = task?.courseId ?? (linkedCourseIds.length === 1 ? linkedCourseIds[0] : null);
      return { kind: 'create', sessionId: crypto.randomUUID(), taskId, courseId, kcId: task?.kcId ?? null, title: taskTitles.get(taskId) ?? scheduled.title ?? 'Study task', before: null, after: { scheduledAt: scheduled.start, plannedMinutes: scheduled.minutes }, reason };
    }
    const sessionId = scheduled.id.slice(2);
    const original = movable.find(({ session }) => session.id === sessionId)?.session;
    if (!original) throw new ConflictError('Planned session is unavailable');
    return { kind: 'update', sessionId, title: original.taskId ? taskTitles.get(original.taskId) ?? 'Planned task study' : 'Study session', before: original.scheduledAt === null ? null : { scheduledAt: original.scheduledAt, plannedMinutes: original.plannedMinutes ?? 25 }, after: { scheduledAt: scheduled.start, plannedMinutes: original.plannedMinutes ?? 25 }, reason };
  });
  const unplaced: Unplaced[] = planned.unplaced.map((item) => ({ id: item.id.slice(2), title: item.title ?? 'Study session', reason: item.reason }));
  for (const item of planned.unplaced.filter((item) => item.id.startsWith('s:'))) {
    const sessionId = item.id.slice(2);
    const original = movable.find(({ session }) => session.id === sessionId)?.session;
    if (!original) continue;
    changes.push({ kind: 'update', sessionId, title: original.taskId ? taskTitles.get(original.taskId) ?? 'Planned task study' : 'Study session', before: original.scheduledAt === null ? null : { scheduledAt: original.scheduledAt, plannedMinutes: original.plannedMinutes ?? 25 }, after: null, reason: item.reason });
  }
  const run = { id: crypto.randomUUID(), userId, status: 'preview' as const, sourceRevision: preference.revision, changes, unplaced, createdAt: now };
  const priors = await db.select().from(planningRuns)
    .where(and(eq(planningRuns.userId, userId), eq(planningRuns.status, 'preview'), eq(planningRuns.sourceRevision, preference.revision)))
    .orderBy(desc(planningRuns.createdAt)).limit(20);
  const prior = priors.find((candidate) => samePreviewContent(candidate, changes, unplaced));
  if (prior) {
    return { ...run, id: prior.id, changes: prior.changes as Change[], unplaced: prior.unplaced as Unplaced[], createdAt: prior.createdAt };
  }
  await db.insert(planningRuns).values(run); return run;
}

async function loadRun(db: Db, userId: string, runId: string) {
  const run = (await db.select().from(planningRuns).where(and(eq(planningRuns.id, runId), eq(planningRuns.userId, userId))).limit(1))[0];
  if (!run) throw new NotFoundError('Planning run');
  return run;
}

async function controlledCalendarConnections(db: Db, userId: string) {
  return db.select({ id: calendarConnections.id }).from(calendarConnections).where(and(
    eq(calendarConnections.userId, userId),
    eq(calendarConnections.status, 'active'),
    eq(calendarConnections.syncMode, 'controlled'),
  ));
}

function planningCalendarOutboxStatements(
  db: Db,
  userId: string,
  connectionIds: string[],
  runId: string,
  phase: 'apply' | 'undo',
  revision: number,
  changes: Change[],
  now: number,
): BatchItem<'sqlite'>[] {
  return connectionIds.flatMap((connectionId) => changes.map((change) => {
    const slot = phase === 'apply' ? change.after : change.kind === 'create' ? null : change.before;
    const action = slot === null ? 'delete' as const : 'upsert' as const;
    const operationRevision = `planning:${runId}:${phase}:${revision}:${change.sessionId}:${action}`;
    return db.insert(calendarOutbox).values({
      id: crypto.randomUUID(),
      userId,
      connectionId,
      action,
      entityType: 'study_session',
      entityId: change.sessionId,
      revision: operationRevision,
      dedupeKey: `${connectionId}:study_session:${change.sessionId}:${action}:${operationRevision}`,
      availableAt: now,
      updatedAt: now,
      createdAt: now,
    }).onConflictDoNothing({ target: calendarOutbox.dedupeKey });
  }));
}

export async function applyPlan(db: Db, userId: string, runId: string, sourceRevision: number, now = Date.now()) {
  await requireActiveUser(db, userId);
  const run = await loadRun(db, userId, runId);
  if (run.status !== 'preview' || run.sourceRevision !== sourceRevision) throw new ConflictError('Planning preview is stale');
  const changes = run.changes as Change[];
  // Snapshot before the batch. The first batch statement below is the actual
  // CAS fence: it increments revision or violates the table CHECK with -1,
  // rolling every companion mutation back. Never await while applying=true.
  for (const change of changes.filter((change): change is UpdateChange => change.kind === 'update')) {
    const row = (await db.select({ session: studySessions, timing: studySessionTiming }).from(studySessions).leftJoin(studySessionTiming, eq(studySessionTiming.sessionId, studySessions.id))
      .where(and(eq(studySessions.id, change.sessionId), eq(studySessions.userId, userId))).limit(1))[0];
    if (!row || row.session.endedAt !== null || row.session.locked || row.timing?.state === 'running'
      || (change.before === null ? !row.session.planningUnscheduled || row.session.scheduledAt !== null : row.session.scheduledAt !== change.before.scheduledAt || (row.session.plannedMinutes ?? 25) !== change.before.plannedMinutes)) throw new ConflictError('A planned session changed before apply');
  }
  const appliedRevision = sourceRevision + 1;
  const connectionIds = (await controlledCalendarConnections(db, userId)).map((connection) => connection.id);
  const sessionStatements: BatchItem<'sqlite'>[] = [];
  for (const change of changes) {
    if (change.kind === 'create') {
      sessionStatements.push(db.insert(studySessions).values({ id: change.sessionId, userId, courseId: change.courseId, taskId: change.taskId, intendedEventType: 'practice_done', plannedMinutes: change.after.plannedMinutes, startedAt: change.after.scheduledAt, scheduledAt: change.after.scheduledAt, managed: true }));
      if (change.kcId) sessionStatements.push(db.insert(sessionKcs).values({ id: crypto.randomUUID(), studySessionId: change.sessionId, kcId: change.kcId }));
    } else {
      const plannedMinutes = change.after?.plannedMinutes ?? change.before?.plannedMinutes ?? 25;
      sessionStatements.push(db.update(studySessions).set({ scheduledAt: change.after?.scheduledAt ?? null, plannedMinutes, planningUnscheduled: change.after === null }).where(and(eq(studySessions.id, change.sessionId), eq(studySessions.userId, userId))));
    }
  }
  try {
    await runBatch(db, [
      db.update(planningPreferences).set({
        applying: true, updatedAt: now,
        revision: sql`CASE WHEN ${planningPreferences.revision} = ${sourceRevision} AND ${planningPreferences.applying} = 0 AND ${planningPreferences.enabled} = 1 THEN ${appliedRevision} ELSE -1 END`,
      }).where(eq(planningPreferences.userId, userId)),
      ...sessionStatements,
      ...planningCalendarOutboxStatements(db, userId, connectionIds, runId, 'apply', appliedRevision, changes, now),
      db.update(planningRuns).set({ status: 'applied', appliedRevision, appliedAt: now }).where(and(eq(planningRuns.id, runId), eq(planningRuns.status, 'preview'))),
      db.update(planningPreferences).set({ applying: false, updatedAt: now }).where(and(eq(planningPreferences.userId, userId), eq(planningPreferences.applying, true))),
    ]);
  } catch (error) {
    throw error instanceof ConflictError ? error : new ConflictError('Planning changed before apply');
  }
  return { ...run, status: 'applied' as const, appliedRevision, appliedAt: now };
}

export async function undoPlan(db: Db, userId: string, runId: string, now = Date.now()) {
  await requireActiveUser(db, userId);
  const run = await loadRun(db, userId, runId);
  if (run.status !== 'applied' || run.appliedRevision === null) throw new ConflictError('Planning run cannot be undone');
  const latest = (await db.select({ id: planningRuns.id }).from(planningRuns).where(and(eq(planningRuns.userId, userId), eq(planningRuns.status, 'applied'))).orderBy(desc(planningRuns.appliedAt)).limit(1))[0];
  if (latest?.id !== runId) throw new ConflictError('Only the latest applied planning run can be undone');
  const changes = run.changes as Change[];
  const undoneRevision = run.appliedRevision + 1;
  const connectionIds = (await controlledCalendarConnections(db, userId)).map((connection) => connection.id);
  try {
    await runBatch(db, [
      db.update(planningPreferences).set({
        applying: true, updatedAt: now,
        revision: sql`CASE WHEN ${planningPreferences.revision} = ${run.appliedRevision} AND ${planningPreferences.applying} = 0 THEN ${undoneRevision} ELSE -1 END`,
      }).where(eq(planningPreferences.userId, userId)),
      ...changes.map((change) => change.kind === 'create'
        ? db.delete(studySessions).where(and(eq(studySessions.id, change.sessionId), eq(studySessions.userId, userId), eq(studySessions.managed, true), eq(studySessions.scheduledAt, change.after.scheduledAt), isNull(studySessions.endedAt)))
        : db.update(studySessions).set({ scheduledAt: change.before?.scheduledAt ?? null, plannedMinutes: change.before?.plannedMinutes ?? change.after?.plannedMinutes ?? 25, planningUnscheduled: change.before === null }).where(and(eq(studySessions.id, change.sessionId), eq(studySessions.userId, userId), change.after === null ? isNull(studySessions.scheduledAt) : eq(studySessions.scheduledAt, change.after.scheduledAt), eq(studySessions.locked, false), isNull(studySessions.endedAt))),
      ),
      ...planningCalendarOutboxStatements(db, userId, connectionIds, runId, 'undo', undoneRevision, changes, now),
      db.update(planningRuns).set({ status: 'undone' }).where(and(eq(planningRuns.id, runId), eq(planningRuns.status, 'applied'))),
      db.delete(planningJobs).where(eq(planningJobs.userId, userId)),
      db.update(planningPreferences).set({ applying: false, nextReviewAt: now + 86_400_000, updatedAt: now }).where(and(eq(planningPreferences.userId, userId), eq(planningPreferences.applying, true))),
    ]);
  } catch (error) {
    throw error instanceof ConflictError ? error : new ConflictError('Planning changed before undo');
  }
  return { ...run, status: 'undone' as const };
}

export async function listPlanningRuns(db: Db, userId: string) {
  await requireActiveUser(db, userId);
  return db.select().from(planningRuns).where(eq(planningRuns.userId, userId)).orderBy(desc(planningRuns.createdAt)).limit(20);
}

export async function processPlanningJobs(db: Db, options: { now?: number; limit?: number } = {}) {
  const now = options.now ?? Date.now();
  const reviews = await db.select({ userId: planningPreferences.userId }).from(planningPreferences).innerJoin(users, eq(users.id, planningPreferences.userId)).where(and(eq(planningPreferences.enabled, true), lte(planningPreferences.nextReviewAt, now), eq(users.accountState, 'active'))).orderBy(asc(planningPreferences.nextReviewAt)).limit(20);
  for (const review of reviews) await runBatch(db, [db.insert(planningJobs).values({ userId: review.userId, availableAt: now, requestedAt: now }).onConflictDoNothing(), db.update(planningPreferences).set({ nextReviewAt: now + 86_400_000 }).where(and(eq(planningPreferences.userId, review.userId), lte(planningPreferences.nextReviewAt, now)))]);
  const jobs = await db.select().from(planningJobs).where(lte(planningJobs.availableAt, now)).orderBy(asc(planningJobs.availableAt)).limit(Math.min(options.limit ?? 20, 20));
  let applied = 0;
  let processed = 0;
  for (const job of jobs) {
    const claimed = (await db.update(planningJobs).set({
      version: sql`${planningJobs.version} + 1`,
      availableAt: now + PLANNING_JOB_LEASE_MS,
    }).where(and(
      eq(planningJobs.userId, job.userId),
      eq(planningJobs.version, job.version),
      lte(planningJobs.availableAt, now),
    )).returning())[0];
    if (!claimed) continue;
    processed += 1;
    try {
      const run = await previewPlan(db, claimed.userId, now);
      await applyPlan(db, claimed.userId, run.id, run.sourceRevision, now);
      await db.delete(planningJobs).where(and(eq(planningJobs.userId, claimed.userId), eq(planningJobs.version, claimed.version)));
      applied += 1;
    } catch {
      const attempts = claimed.attemptCount + 1;
      const delay = Math.min(60 * 60_000, 1_000 * 2 ** Math.min(attempts, 10));
      await db.update(planningJobs).set({ attemptCount: attempts, availableAt: now + delay })
        .where(and(eq(planningJobs.userId, claimed.userId), eq(planningJobs.version, claimed.version)));
    }
  }
  return { processed, applied };
}
