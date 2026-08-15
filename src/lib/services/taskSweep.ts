// Task sweep (v1.4): idempotent generator for system tasks — same idiom as
// sweepNotifications/sweepClassSessions (INSERT ... ON CONFLICT(dedupe_key)
// DO NOTHING, run at the top of every list call: listTasks + getCalendar).
// Six independently-toggleable generator families live in
// users.settings.task_generators (see schemas/user.ts, services/user.ts);
// each has one collector below, named after its family (policy table:
// docs/architecture — family -> query/dueDate/dedupe-key). A collector's
// rows must set `source: 'system'` and a unique `dedupeKey` — those two
// fields are what let deleteTask/sweepTasks tell a generated row apart from
// a user-minted todo.
import { and, eq, gt, gte, isNotNull, isNull, lt, lte } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assessmentKcs, assessments, classSessions, courses, kcs, taskCourses, tasks, users } from '../../db/schema';
import { isoWeekday, localNoon, parseMeetingDays } from './classSessions';
import { resolveSettings, type ResolvedSettings } from './user';

type NewTask = typeof tasks.$inferInsert;
type GeneratorFamily = keyof ResolvedSettings['task_generators'];

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DISMISSED_AGE_MS = 120 * 24 * 60 * 60 * 1000;

const ATTEND_CLASS_WINDOW_MS = 7 * DAY_MS;
const PREP_BEFORE_CLASS_WINDOW_DAYS = 2;
const REVIEW_AFTER_CLASS_LOOKBACK_MS = 3 * DAY_MS;
const PRACTICE_KC_WINDOW_MS = 7 * DAY_MS;
const PRACTICE_KC_MASTERY_THRESHOLD = 80;
const PRACTICE_KC_CAP_PER_ASSESSMENT = 5;
const STALE_KC_IDLE_MS = 7 * DAY_MS;
const STALE_KC_CAP_PER_SWEEP = 3;
const STALE_KC_CAP_PER_COURSE = 1;
const GRADE_ENTRY_LOOKBACK_MS = 14 * DAY_MS;
const GRADE_ENTRY_FOLLOWUP_MS = 3 * DAY_MS;

// UTC calendar-day key for a noon-normalized ms value, e.g. "20260813" —
// same shape as scripts/seed.ts's helper of the same name. Used to re-key
// prep_before_class's dedupe on the class day it targets (there's no
// class_sessions row yet for a future day to key off of instead).
function yyyymmdd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// --- Collectors (one per generator family) --------------------------------
// Each returns candidate rows for its family; sweepTasks below dedupes them
// via ON CONFLICT(dedupe_key) DO NOTHING, so a collector may safely return
// rows that already exist. All course-scoped queries skip archived courses
// — a course you've shelved shouldn't keep minting work.

async function collectAttendClass(db: Db, userId: string, now: number): Promise<NewTask[]> {
  const todayNoon = localNoon(now);
  const windowStart = todayNoon - ATTEND_CLASS_WINDOW_MS;
  const windowEnd = todayNoon + ATTEND_CLASS_WINDOW_MS;

  const rows = await db
    .select({
      id: classSessions.id,
      date: classSessions.date,
      status: classSessions.status,
      courseId: classSessions.courseId,
      courseCode: courses.code,
    })
    .from(classSessions)
    .innerJoin(courses, eq(classSessions.courseId, courses.id))
    .where(
      and(
        eq(classSessions.userId, userId),
        eq(courses.archived, false),
        gte(classSessions.date, windowStart),
        lte(classSessions.date, windowEnd),
      ),
    );

  // A session already marked attended (including retroactively, before this
  // sweep ever ran) inserts pre-completed — the task shows up already
  // checked off rather than as outstanding work.
  return rows.map((r) => {
    const attended = r.status === 'attended';
    return {
      id: crypto.randomUUID(),
      userId,
      title: `Attend ${r.courseCode}`,
      description: `Class session — ${r.courseCode}`,
      type: 'attend_class' as const,
      dueDate: r.date,
      courseId: r.courseId,
      classSessionId: r.id,
      done: attended,
      completedAt: attended ? now : null,
      source: 'system' as const,
      dedupeKey: `attend_class:${r.id}`,
      createdAt: now,
    };
  });
}

async function collectPrepBeforeClass(db: Db, userId: string, now: number): Promise<NewTask[]> {
  const todayNoon = localNoon(now);

  const courseRows = await db
    .select({ id: courses.id, code: courses.code, meetingDays: courses.meetingDays })
    .from(courses)
    .where(and(eq(courses.userId, userId), eq(courses.archived, false)));

  const candidates: NewTask[] = [];
  for (const course of courseRows) {
    const meetingDays = parseMeetingDays(course.meetingDays);
    if (meetingDays.length === 0) continue;

    // (today, today+2d]: tomorrow and the day after. Derived straight from
    // meetingDays rather than class_sessions — the sessions sweep never
    // generates rows ahead of today, so no future row exists to read yet.
    for (let offsetDays = 1; offsetDays <= PREP_BEFORE_CLASS_WINDOW_DAYS; offsetDays++) {
      const classDay = todayNoon + offsetDays * DAY_MS;
      if (!meetingDays.includes(isoWeekday(classDay))) continue;

      candidates.push({
        id: crypto.randomUUID(),
        userId,
        title: `Prep for ${course.code}`,
        description: `Get ready for ${course.code}'s upcoming class`,
        type: 'prep_before_class',
        dueDate: classDay - DAY_MS,
        courseId: course.id,
        source: 'system',
        dedupeKey: `prep_before_class:${course.id}:${yyyymmdd(classDay)}`,
        createdAt: now,
      });
    }
  }
  return candidates;
}

async function collectReviewAfterClass(db: Db, userId: string, now: number): Promise<NewTask[]> {
  const lookbackStart = localNoon(now) - REVIEW_AFTER_CLASS_LOOKBACK_MS;

  const rows = await db
    .select({
      id: classSessions.id,
      date: classSessions.date,
      courseId: classSessions.courseId,
      courseCode: courses.code,
    })
    .from(classSessions)
    .innerJoin(courses, eq(classSessions.courseId, courses.id))
    .where(
      and(
        eq(classSessions.userId, userId),
        eq(courses.archived, false),
        eq(classSessions.status, 'attended'),
        gte(classSessions.date, lookbackStart),
      ),
    );

  return rows.map((r) => ({
    id: crypto.randomUUID(),
    userId,
    title: `Review notes: ${r.courseCode}`,
    description: `Review your notes from ${r.courseCode}'s class`,
    type: 'review_after_class' as const,
    dueDate: r.date + DAY_MS,
    courseId: r.courseId,
    classSessionId: r.id,
    source: 'system' as const,
    dedupeKey: `review_after_class:${r.id}`,
    createdAt: now,
  }));
}

async function collectPracticeKc(db: Db, userId: string, now: number): Promise<NewTask[]> {
  const rows = await db
    .select({
      assessmentId: assessments.id,
      assessmentTitle: assessments.title,
      dueDate: assessments.dueDate,
      courseId: assessments.courseId,
      kcId: kcs.id,
      kcName: kcs.name,
      mastery: kcs.mastery,
    })
    .from(assessments)
    .innerJoin(courses, eq(assessments.courseId, courses.id))
    .innerJoin(assessmentKcs, eq(assessmentKcs.assessmentId, assessments.id))
    .innerJoin(kcs, eq(assessmentKcs.kcId, kcs.id))
    .where(
      and(
        eq(courses.userId, userId),
        eq(courses.archived, false),
        eq(assessments.kind, 'official'),
        isNull(assessments.gradeReceived),
        gt(assessments.dueDate, now),
        lte(assessments.dueDate, now + PRACTICE_KC_WINDOW_MS),
        lt(kcs.mastery, PRACTICE_KC_MASTERY_THRESHOLD),
      ),
    );

  const byAssessment = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byAssessment.get(row.assessmentId);
    if (group) group.push(row);
    else byAssessment.set(row.assessmentId, [row]);
  }

  const candidates: NewTask[] = [];
  for (const group of byAssessment.values()) {
    const dueDate = localNoon(group[0].dueDate!) - DAY_MS;
    const lowestMasteryFirst = [...group].sort((a, b) => a.mastery - b.mastery).slice(0, PRACTICE_KC_CAP_PER_ASSESSMENT);

    for (const row of lowestMasteryFirst) {
      candidates.push({
        id: crypto.randomUUID(),
        userId,
        title: `Practice ${row.kcName} for ${row.assessmentTitle}`,
        description: `${row.kcName} is linked to ${row.assessmentTitle}`,
        type: 'practice_kc',
        dueDate,
        courseId: row.courseId,
        assessmentId: row.assessmentId,
        kcId: row.kcId,
        source: 'system',
        dedupeKey: `practice_kc:${row.assessmentId}:${row.kcId}`,
        createdAt: now,
      });
    }
  }
  return candidates;
}

async function collectStaleKc(db: Db, userId: string, now: number): Promise<NewTask[]> {
  const rows = await db
    .select({
      kcId: kcs.id,
      kcName: kcs.name,
      mastery: kcs.mastery,
      lastEventAt: kcs.lastEventAt,
      courseId: kcs.courseId,
    })
    .from(kcs)
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(
      and(
        eq(courses.userId, userId),
        eq(courses.archived, false),
        gt(kcs.mastery, 0),
        lt(kcs.lastEventAt, now - STALE_KC_IDLE_MS),
      ),
    );

  const lowestMasteryFirst = [...rows].sort((a, b) => a.mastery - b.mastery);
  const perCourseCount = new Map<string, number>();
  const candidates: NewTask[] = [];

  for (const row of lowestMasteryFirst) {
    if (candidates.length >= STALE_KC_CAP_PER_SWEEP) break;
    const courseCount = perCourseCount.get(row.courseId) ?? 0;
    if (courseCount >= STALE_KC_CAP_PER_COURSE) continue;
    perCourseCount.set(row.courseId, courseCount + 1);

    candidates.push({
      id: crypto.randomUUID(),
      userId,
      title: `Revisit ${row.kcName}`,
      description: `${row.kcName} hasn't been practiced recently`,
      type: 'stale_kc',
      dueDate: null,
      courseId: row.courseId,
      kcId: row.kcId,
      source: 'system',
      dedupeKey: `stale_kc:${row.kcId}:${row.lastEventAt ?? 0}`,
      createdAt: now,
    });
  }
  return candidates;
}

async function collectGradeEntry(db: Db, userId: string, now: number): Promise<NewTask[]> {
  const rows = await db
    .select({
      id: assessments.id,
      title: assessments.title,
      dueDate: assessments.dueDate,
      courseId: assessments.courseId,
    })
    .from(assessments)
    .innerJoin(courses, eq(assessments.courseId, courses.id))
    .where(
      and(
        eq(courses.userId, userId),
        eq(courses.archived, false),
        eq(assessments.kind, 'official'),
        isNull(assessments.gradeReceived),
        gte(assessments.dueDate, now - GRADE_ENTRY_LOOKBACK_MS),
        lt(assessments.dueDate, now),
      ),
    );

  return rows.map((r) => ({
    id: crypto.randomUUID(),
    userId,
    title: `Enter grade: ${r.title}`,
    description: `Enter your grade for ${r.title}`,
    type: 'grade_entry' as const,
    dueDate: localNoon(r.dueDate!) + GRADE_ENTRY_FOLLOWUP_MS,
    courseId: r.courseId,
    assessmentId: r.id,
    source: 'system' as const,
    dedupeKey: `grade_entry:${r.id}`,
    createdAt: now,
  }));
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
  // read-notification purge in sweepNotifications). Scoped to this user —
  // an unscoped purge here would delete every user's old dismissed rows on
  // every single sweep call.
  await db
    .delete(tasks)
    .where(and(eq(tasks.userId, userId), isNotNull(tasks.dismissedAt), lt(tasks.dismissedAt, now - RETENTION_DISMISSED_AGE_MS)));
}
