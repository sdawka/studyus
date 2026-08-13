// Task sweep (v1.4): idempotent generator for system tasks — same idiom as
// sweepNotifications/sweepClassSessions (INSERT ... ON CONFLICT(dedupe_key)
// DO NOTHING, run at the top of every list call: listTasks + getCalendar).
// Six independently-toggleable generator families live in
// users.settings.task_generators (see schemas/user.ts, services/user.ts);
// each has one collector below, named after its family. This file owns only
// the orchestration shape — collector bodies are stubbed here and filled in
// by a later track against the policy table in the plan (family →
// query/dueDate/dedupe-key). A collector's rows must set `source: 'system'`
// and a unique `dedupeKey` (see the per-family key formats in the plan) —
// those two fields are what let deleteTask/sweepTasks tell a generated row
// apart from a user-minted todo.
import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { taskCourses, tasks, users } from '../../db/schema';
import { resolveSettings, type ResolvedSettings } from './user';

type NewTask = typeof tasks.$inferInsert;
type GeneratorFamily = keyof ResolvedSettings['task_generators'];

const RETENTION_DISMISSED_AGE_MS = 120 * 24 * 60 * 60 * 1000;

// --- Collectors (one per generator family) --------------------------------
// Each returns candidate rows for its family; sweepTasks below dedupes them
// via ON CONFLICT(dedupe_key) DO NOTHING, so a collector may safely return
// rows that already exist. Stubbed — see the plan's Part 2 policy table for
// the query/dueDate/dedupe-key each one needs.

async function collectAttendClass(_db: Db, _userId: string, _now: number): Promise<NewTask[]> {
  return [];
}

async function collectPrepBeforeClass(_db: Db, _userId: string, _now: number): Promise<NewTask[]> {
  return [];
}

async function collectReviewAfterClass(_db: Db, _userId: string, _now: number): Promise<NewTask[]> {
  return [];
}

async function collectPracticeKc(_db: Db, _userId: string, _now: number): Promise<NewTask[]> {
  return [];
}

async function collectStaleKc(_db: Db, _userId: string, _now: number): Promise<NewTask[]> {
  return [];
}

async function collectGradeEntry(_db: Db, _userId: string, _now: number): Promise<NewTask[]> {
  return [];
}

const COLLECTORS: Record<GeneratorFamily, (db: Db, userId: string, now: number) => Promise<NewTask[]>> = {
  attend_class: collectAttendClass,
  prep_before_class: collectPrepBeforeClass,
  review_after_class: collectReviewAfterClass,
  practice_kc: collectPracticeKc,
  stale_kc: collectStaleKc,
  grade_entry: collectGradeEntry,
};

/** Idempotent: safe to call on every list request (listTasks, getCalendar). */
export async function sweepTasks(db: Db, userId: string, now: number = Date.now()): Promise<void> {
  const userRows = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).limit(1);
  const { task_generators: generators } = resolveSettings(userRows[0]?.settings);

  const enabledFamilies = (Object.keys(COLLECTORS) as GeneratorFamily[]).filter((family) => generators[family]);
  if (enabledFamilies.length === 0) return;

  const candidateBatches = await Promise.all(enabledFamilies.map((family) => COLLECTORS[family](db, userId, now)));
  const candidates = candidateBatches.flat();

  if (candidates.length > 0) {
    const inserts = candidates.map((row) => db.insert(tasks).values(row).onConflictDoNothing({ target: tasks.dedupeKey }));
    await db.batch(inserts as [(typeof inserts)[number], ...(typeof inserts)[number][]]);
  }

  // Two-pass task_courses backfill — load-bearing, must NOT be folded into
  // the insert batch above. After ON CONFLICT DO NOTHING, a candidate whose
  // dedupe key already existed doesn't tell us the surviving row's id (it
  // may have been inserted by an earlier sweep entirely) — so pass 1 can't
  // know which task_courses rows to write in the same breath as the task
  // insert. Instead, pass 2 re-reads system tasks with a courseId that are
  // missing their task_courses link (LEFT JOIN ... IS NULL) and backfills
  // those; onConflictDoNothing on the (task_id, course_id) unique index
  // makes this pass itself idempotent, so re-running the sweep never
  // double-links.
  const missingLinks = await db
    .select({ taskId: tasks.id, courseId: tasks.courseId })
    .from(tasks)
    .leftJoin(taskCourses, and(eq(taskCourses.taskId, tasks.id), eq(taskCourses.courseId, tasks.courseId)))
    .where(and(eq(tasks.userId, userId), eq(tasks.source, 'system'), isNotNull(tasks.courseId), isNull(taskCourses.id)));

  if (missingLinks.length > 0) {
    const linkInserts = missingLinks.map((link) =>
      db
        .insert(taskCourses)
        .values({ id: crypto.randomUUID(), taskId: link.taskId, courseId: link.courseId! })
        .onConflictDoNothing({ target: [taskCourses.taskId, taskCourses.courseId] }),
    );
    await db.batch(linkInserts as [(typeof linkInserts)[number], ...(typeof linkInserts)[number][]]);
  }

  // Retention: purge dismissed system tasks older than 120d (mirrors the
  // read-notification purge in sweepNotifications).
  await db.delete(tasks).where(and(isNotNull(tasks.dismissedAt), lt(tasks.dismissedAt, now - RETENTION_DISMISSED_AGE_MS)));
}
