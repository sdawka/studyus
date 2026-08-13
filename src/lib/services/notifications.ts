// Notifications service. Generation is an idempotent sweep (4 indexed
// SELECTs + one db.batch of INSERT ... ON CONFLICT(dedupe_key) DO NOTHING)
// run at the top of every list call, plus retention trimming in the same
// sweep. The one non-sweep write path is createNotification, called inline
// from services/assessments.ts at the grade-entry site (grade_recorded).
import { and, desc, eq, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assessments, courses, kcs, notifications, studySessions, tasks } from '../../db/schema';
import type { CreateNotificationInput } from '../schemas/notifications';

const ASSESSMENT_DUE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const SESSION_UNFINISHED_AGE_MS = 6 * 60 * 60 * 1000;
const RETENTION_READ_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RETENTION_MAX_PER_USER = 100;

type NewNotification = typeof notifications.$inferInsert;

async function collectAssessmentDue(db: Db, userId: string, now: number): Promise<NewNotification[]> {
  const rows = await db
    .select({
      id: assessments.id,
      title: assessments.title,
      dueDate: assessments.dueDate,
      courseId: assessments.courseId,
      courseSlug: courses.slug,
    })
    .from(assessments)
    .innerJoin(courses, eq(assessments.courseId, courses.id))
    .where(
      and(
        eq(courses.userId, userId),
        isNull(assessments.gradeReceived),
        lte(assessments.dueDate, now + ASSESSMENT_DUE_WINDOW_MS),
      ),
    );

  return rows
    .filter((r) => r.dueDate !== null && r.dueDate >= now - ASSESSMENT_DUE_WINDOW_MS)
    .map((r) => ({
      id: crypto.randomUUID(),
      userId,
      type: 'assessment_due' as const,
      title: `Assessment due soon: ${r.title}`,
      courseId: r.courseId,
      href: `/courses/${r.courseSlug}`,
      dedupeKey: `assessment_due:${r.id}`,
      createdAt: now,
    }));
}

// System tasks are self-advertising (they're the reminder) — scoped to
// source: 'user' so the sweep never double-notifies a generated task that's
// already showing up in Today's task list. Dismissed tasks are gone from
// that list entirely, so they're excluded too.
async function collectTaskOverdue(db: Db, userId: string, now: number): Promise<NewNotification[]> {
  const rows = await db
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.done, false),
        lt(tasks.dueDate, now),
        isNull(tasks.dismissedAt),
        eq(tasks.source, 'user'),
      ),
    );

  return rows
    .filter((r) => r.dueDate !== null)
    .map((r) => ({
      id: crypto.randomUUID(),
      userId,
      type: 'task_overdue' as const,
      title: `Overdue: ${r.title}`,
      courseId: null,
      href: `/tasks`,
      dedupeKey: `task_overdue:${r.id}:${r.dueDate}`,
      createdAt: now,
    }));
}

async function collectKcReview(db: Db, userId: string, now: number): Promise<NewNotification[]> {
  const rows = await db
    .select({
      id: kcs.id,
      name: kcs.name,
      lastEventAt: kcs.lastEventAt,
      courseId: kcs.courseId,
      courseSlug: courses.slug,
    })
    .from(kcs)
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(eq(courses.userId, userId), eq(kcs.status, 'review')));

  return rows.map((r) => ({
    id: crypto.randomUUID(),
    userId,
    type: 'kc_review' as const,
    title: `${r.name} needs review`,
    courseId: r.courseId,
    href: `/courses/${r.courseSlug}/kc/${r.id}`,
    dedupeKey: `kc_review:${r.id}:${r.lastEventAt ?? 0}`,
    createdAt: now,
  }));
}

async function collectSessionUnfinished(db: Db, userId: string, now: number): Promise<NewNotification[]> {
  const rows = await db
    .select({ id: studySessions.id, startedAt: studySessions.startedAt })
    .from(studySessions)
    .where(
      and(
        eq(studySessions.userId, userId),
        isNull(studySessions.endedAt),
        lt(studySessions.startedAt, now - SESSION_UNFINISHED_AGE_MS),
      ),
    );

  return rows.map((r) => ({
    id: crypto.randomUUID(),
    userId,
    type: 'session_unfinished' as const,
    title: `Unfinished study session`,
    courseId: null,
    href: `/study`,
    dedupeKey: `session_unfinished:${r.id}`,
    createdAt: now,
  }));
}

/** Idempotent: safe to call on every list request. Generates due rows via
 * ON CONFLICT(dedupe_key) DO NOTHING, then purges/trims per retention rules. */
export async function sweepNotifications(db: Db, userId: string, now: number = Date.now()) {
  const [dueSoon, overdue, review, unfinished] = await Promise.all([
    collectAssessmentDue(db, userId, now),
    collectTaskOverdue(db, userId, now),
    collectKcReview(db, userId, now),
    collectSessionUnfinished(db, userId, now),
  ]);

  const candidates = [...dueSoon, ...overdue, ...review, ...unfinished];
  if (candidates.length > 0) {
    const inserts = candidates.map((row) =>
      db.insert(notifications).values(row).onConflictDoNothing({ target: notifications.dedupeKey }),
    );
    await db.batch(inserts as [(typeof inserts)[number], ...(typeof inserts)[number][]]);
  }

  // Retention: purge read notifications older than 30d.
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNotNull(notifications.readAt),
        lt(notifications.readAt, now - RETENTION_READ_AGE_MS),
      ),
    );

  // Retention: trim to the newest 100 per user. Done as a correlated
  // subquery (rather than fetching ids and binding a NOT IN list) since D1
  // caps bound parameters per query well under what a user's full
  // notification history could require.
  await db.delete(notifications).where(
    and(
      eq(notifications.userId, userId),
      sql`${notifications.id} not in (
        select id from notifications
        where user_id = ${userId}
        order by created_at desc
        limit ${RETENTION_MAX_PER_USER}
      )`,
    ),
  );
}

export async function listNotifications(
  db: Db,
  userId: string,
  opts: { unread?: boolean; limit?: number } = {},
) {
  await sweepNotifications(db, userId);

  const conditions = [eq(notifications.userId, userId)];
  if (opts.unread) conditions.push(isNull(notifications.readAt));

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit ?? 20);

  const unreadRows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return { notifications: rows, unread_count: unreadRows.length };
}

export async function markRead(db: Db, userId: string, id: string) {
  await db.update(notifications).set({ readAt: Date.now() }).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllRead(db: Db, userId: string) {
  await db
    .update(notifications)
    .set({ readAt: Date.now() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function createNotification(db: Db, input: CreateNotificationInput) {
  await db
    .insert(notifications)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      courseId: input.courseId ?? null,
      href: input.href,
      dedupeKey: input.dedupeKey,
      createdAt: Date.now(),
    })
    .onConflictDoNothing({ target: notifications.dedupeKey });
}
