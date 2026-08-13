// Class sessions service (v1.3): attendance re-modeled as pre-existing
// scheduled rows whose status gets updated, not events appended by button
// clicks. Generation is an idempotent sweep (same pattern as
// services/notifications.ts::sweepNotifications) run at the top of the list
// call: for a course with `meetingDays`, INSERT OR IGNORE one row per
// matching weekday from 70 days back through today (never future), keyed
// idempotent via UNIQUE(course_id, date). One-time backfill: a freshly
// generated row's initial status is seeded from any lecture_attended /
// lecture_missed event the user logged for that course on the same local
// day (attended wins if both exist) — after that, status is only ever
// changed via PATCH, never by the sweep re-running.
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { classSessions, events, tasks } from '../../db/schema';
import type { CreateClassSessionInput, ListClassSessionsQuery, UpdateClassSessionInput } from '../schemas/classSessions';
import { toEpochMs } from '../schemas/common';
import { ConflictError, NotFoundError, requireOwnedCourse } from './util';

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_WINDOW_DAYS = 70;
const LECTURE_EVENT_TYPES = ['lecture_attended', 'lecture_missed'] as const;

// Epoch ms at local noon of the calendar day containing `ms` — noon avoids a
// TZ day-shift when the value is later rendered as an ISO date. "Local" here
// means UTC explicitly (setUTCHours, not setHours): the Workers runtime this
// service actually runs in is always UTC, so this has never behaved
// differently in production/tests, but scripts/seed.ts runs under plain
// Node on a host with a real local TZ — using the runtime-implicit
// `setHours` there silently drifted the seeded date off of what this sweep
// generates for the same calendar day (see the "duplicate row" bug this
// fixed: a seed-sourced row for the same day landed a few hours off from a
// schedule-sourced one, so the UNIQUE(course_id, date) index never caught
// the collision). Being explicit here — and in seed.ts's equivalent helper
// — removes the ambiguity for both callers.
export function localNoon(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(12, 0, 0, 0);
  return d.getTime();
}

/** Normalizes an arbitrary ISO datetime to local noon of its calendar day. */
export function toLocalNoon(iso: string): number {
  return localNoon(toEpochMs(iso));
}

// ISO weekday: Mon=1..Sun=7 (JS Date#getUTCDay is Sun=0..Sat=6).
export function isoWeekday(noonMs: number): number {
  const dow = new Date(noonMs).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function parseMeetingDays(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

/** Idempotent: safe to call on every list request for this course. */
async function sweepClassSessions(db: Db, userId: string, courseId: string, meetingDaysRaw: string | null, now: number) {
  const meetingDays = parseMeetingDays(meetingDaysRaw);
  if (meetingDays.length === 0) return;

  const todayNoon = localNoon(now);
  const startNoon = todayNoon - SWEEP_WINDOW_DAYS * DAY_MS;

  // Backfill lookup: every lecture_attended/lecture_missed event for this
  // course in the swept window, bucketed by the local day it falls on.
  const lectureEvents = await db
    .select({ ts: events.ts, type: events.type })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.courseId, courseId),
        inArray(events.type, LECTURE_EVENT_TYPES),
        gte(events.ts, startNoon - DAY_MS / 2),
        lte(events.ts, todayNoon + DAY_MS / 2),
      ),
    );

  const statusByDay = new Map<number, 'attended' | 'missed'>();
  for (const ev of lectureEvents) {
    const day = localNoon(ev.ts);
    if (ev.type === 'lecture_attended') {
      statusByDay.set(day, 'attended'); // attended always wins, regardless of iteration order
    } else if (!statusByDay.has(day)) {
      statusByDay.set(day, 'missed');
    }
  }

  const candidates: (typeof classSessions.$inferInsert)[] = [];
  for (let day = startNoon; day <= todayNoon; day += DAY_MS) {
    if (!meetingDays.includes(isoWeekday(day))) continue;
    candidates.push({
      id: crypto.randomUUID(),
      userId,
      courseId,
      date: day,
      status: statusByDay.get(day) ?? null,
      note: null,
      source: 'schedule',
      createdAt: now,
    });
  }
  if (candidates.length === 0) return;

  const inserts = candidates.map((row) =>
    db
      .insert(classSessions)
      .values(row)
      .onConflictDoNothing({ target: [classSessions.courseId, classSessions.date] }),
  );
  await db.batch(inserts as [(typeof inserts)[number], ...(typeof inserts)[number][]]);
}

export async function listClassSessions(
  db: Db,
  userId: string,
  courseId: string,
  query: ListClassSessionsQuery = {},
) {
  const course = await requireOwnedCourse(db, userId, courseId);
  await sweepClassSessions(db, userId, courseId, course.meetingDays, Date.now());

  const conditions = [eq(classSessions.courseId, courseId), eq(classSessions.userId, userId)];
  if (query.from) conditions.push(gte(classSessions.date, toEpochMs(query.from)));
  if (query.to) conditions.push(lte(classSessions.date, toEpochMs(query.to)));

  return db
    .select()
    .from(classSessions)
    .where(and(...conditions))
    .orderBy(desc(classSessions.date))
    .limit(query.limit ?? 100);
}

async function requireOwnedClassSession(db: Db, userId: string, id: string) {
  const rows = await db
    .select()
    .from(classSessions)
    .where(and(eq(classSessions.id, id), eq(classSessions.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Class session');
  return row;
}

export async function updateClassSessionStatus(db: Db, userId: string, id: string, input: UpdateClassSessionInput) {
  await requireOwnedClassSession(db, userId, id);
  await db.update(classSessions).set({ status: input.status }).where(eq(classSessions.id, id));

  // Two-way sync (v1.4) with the linked attend_class task, if one exists —
  // raw db.update, never the tasks service, so this can't loop with
  // updateTask's own class_sessions sync (services/tasks.ts). Syncing a
  // dismissed task row is harmless: dismissal only hides it from list/
  // calendar output, it doesn't stop it existing.
  if (input.status === 'attended') {
    await db
      .update(tasks)
      .set({ done: true, completedAt: Date.now() })
      .where(and(eq(tasks.classSessionId, id), eq(tasks.type, 'attend_class'), eq(tasks.done, false)));
  } else {
    await db
      .update(tasks)
      .set({ done: false, completedAt: null })
      .where(and(eq(tasks.classSessionId, id), eq(tasks.type, 'attend_class')));
  }

  const rows = await db.select().from(classSessions).where(eq(classSessions.id, id)).limit(1);
  return rows[0];
}

export async function createManualClassSession(db: Db, userId: string, courseId: string, input: CreateClassSessionInput) {
  await requireOwnedCourse(db, userId, courseId);
  const date = toLocalNoon(input.date);

  const existing = await db
    .select({ id: classSessions.id })
    .from(classSessions)
    .where(and(eq(classSessions.courseId, courseId), eq(classSessions.date, date)))
    .limit(1);
  if (existing.length > 0) {
    throw new ConflictError('A class session already exists for this course on this date');
  }

  const id = crypto.randomUUID();
  await db.insert(classSessions).values({
    id,
    userId,
    courseId,
    date,
    status: null,
    note: null,
    source: 'manual',
    createdAt: Date.now(),
  });

  const rows = await db.select().from(classSessions).where(eq(classSessions.id, id)).limit(1);
  return rows[0];
}
