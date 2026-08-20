// Rituals CRUD + adherence (v1.9). A ritual is a recurring study practice
// and/or in-session structure (kind: 'recurring'|'session_shape'|'both').
// No adherence table (ADR-004, computed-on-read): recurring adherence folds
// over sweep-minted `ritual` tasks (services/taskSweep.ts::collectRituals),
// session-shape adherence folds over study_sessions.ritualId.
import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { rituals, studySessions, tasks } from '../../db/schema';
import type { CreateRitualInput, RitualStep, UpdateRitualInput } from '../schemas/rituals';
import { localNoon } from './classSessions';
import { NotFoundError, requireOwnedCourse } from './util';

const DAY_MS = 24 * 60 * 60 * 1000;
// The 28-day dot row spans 27 days back through today, plus a 2-day
// forward allowance — matching taskSweep.ts's before_class lookahead
// (PREP_BEFORE_CLASS_WINDOW_DAYS) so an already-minted near-future
// occurrence (the only kind the sweep ever generates ahead of time) still
// shows up as 'upcoming' rather than silently falling outside the window.
const ADHERENCE_WINDOW_BACK_MS = 27 * DAY_MS;
const ADHERENCE_WINDOW_FORWARD_MS = 2 * DAY_MS;

type RitualRow = typeof rituals.$inferSelect;

interface RitualAdherence {
  done_28d: number;
  generated_28d: number;
  session_uses_28d: number;
  occurrences: { date: string; state: 'done' | 'skipped' | 'upcoming' }[];
}

// Mirrors the `userId = ? AND group_id IS NULL` read rule documented on the
// rituals table (data-model.md) — groupId is a forward-looking hook for a
// future group scope, always null in v1.
export async function requireOwnedRitual(db: Db, userId: string, ritualId: string): Promise<RitualRow> {
  const rows = await db
    .select()
    .from(rituals)
    .where(and(eq(rituals.id, ritualId), eq(rituals.userId, userId), isNull(rituals.groupId)))
    .limit(1);
  const ritual = rows[0];
  if (!ritual) throw new NotFoundError('Ritual');
  return ritual;
}

// The calendar day a sweep-minted ritual task's dedupe key encodes
// (`ritual:<ritualId>:<yyyymmdd>`), as an ISO date string. Reading this off
// the dedupe key rather than the task's own dueDate matters for
// after_class/before_class rituals, whose dueDate is intentionally offset a
// day from the occurrence itself (see taskSweep.ts::collectRituals).
function occurrenceDateFromDedupeKey(dedupeKey: string): string {
  const yyyymmdd = dedupeKey.split(':').pop() ?? '';
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function occurrenceMs(dateStr: string): number {
  return Date.parse(`${dateStr}T12:00:00.000Z`);
}

async function computeAdherence(db: Db, userId: string, ritual: RitualRow, now: number): Promise<RitualAdherence> {
  const todayNoon = localNoon(now);
  const windowStart = todayNoon - ADHERENCE_WINDOW_BACK_MS;
  const windowEnd = todayNoon + ADHERENCE_WINDOW_FORWARD_MS;

  const ritualTasks =
    ritual.kind === 'recurring' || ritual.kind === 'both'
      ? await db.select().from(tasks).where(and(eq(tasks.userId, userId), eq(tasks.ritualId, ritual.id)))
      : [];

  const inWindow = ritualTasks
    .map((task) => ({ task, date: occurrenceDateFromDedupeKey(task.dedupeKey ?? '') }))
    .filter(({ date }) => {
      const ms = occurrenceMs(date);
      return Number.isFinite(ms) && ms >= windowStart && ms <= windowEnd;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // 'skipped' (never 'missed' — anti-gamification, vision.md): the row was
  // explicitly dismissed, or its due date has simply passed without being
  // done. 'upcoming' covers today/future occurrences still open.
  const occurrences = inWindow.map(({ task, date }) => {
    let state: 'done' | 'skipped' | 'upcoming';
    if (task.done) state = 'done';
    else if (task.dismissedAt != null) state = 'skipped';
    else if (task.dueDate != null && task.dueDate < now) state = 'skipped';
    else state = 'upcoming';
    return { date, state };
  });

  const sessionRows =
    ritual.kind === 'session_shape' || ritual.kind === 'both'
      ? await db
          .select()
          .from(studySessions)
          .where(
            and(
              eq(studySessions.userId, userId),
              eq(studySessions.ritualId, ritual.id),
              gte(studySessions.startedAt, windowStart),
              lte(studySessions.startedAt, now),
            ),
          )
      : [];

  return {
    done_28d: occurrences.filter((o) => o.state === 'done').length,
    generated_28d: occurrences.length,
    session_uses_28d: sessionRows.length,
    occurrences,
  };
}

// Shapes a ritual row + its adherence block into the frozen GET /rituals
// response (ritualResponseSchema) — camelCase here, toApi() at the route
// layer snake_cases/ISO-dates the top-level fields; adherence's keys are
// already in their final wire shape and pass through unchanged.
function shapeRitual(ritual: RitualRow, adherence: RitualAdherence) {
  return {
    id: ritual.id,
    name: ritual.name,
    description: ritual.description,
    kind: ritual.kind,
    cadence: ritual.cadence,
    byWeekday: ritual.byWeekday,
    courseId: ritual.courseId,
    steps: ritual.steps,
    active: ritual.active,
    createdAt: ritual.createdAt,
    adherence,
  };
}

export async function listRitualsWithAdherence(db: Db, userId: string, now: number = Date.now()) {
  const rows = await db.select().from(rituals).where(and(eq(rituals.userId, userId), isNull(rituals.groupId)));
  return Promise.all(rows.map(async (ritual) => shapeRitual(ritual, await computeAdherence(db, userId, ritual, now))));
}

export async function getRitual(db: Db, userId: string, ritualId: string, now: number = Date.now()) {
  const ritual = await requireOwnedRitual(db, userId, ritualId);
  return shapeRitual(ritual, await computeAdherence(db, userId, ritual, now));
}

// Lightweight list for StudyFlow's session-start ritual picker — active
// session_shape/both rituals only, no adherence fold (that's GET /rituals'
// job; the picker just needs id/name/steps).
export async function listSessionShapeRituals(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(rituals)
    .where(and(eq(rituals.userId, userId), isNull(rituals.groupId), eq(rituals.active, true)));
  return rows
    .filter((r) => r.kind === 'session_shape' || r.kind === 'both')
    .map((r) => ({ id: r.id, name: r.name, steps: ((r.steps as RitualStep[] | null) ?? []) }));
}

export async function createRitual(db: Db, userId: string, input: CreateRitualInput) {
  if (input.course_id) await requireOwnedCourse(db, userId, input.course_id);

  const id = crypto.randomUUID();
  await db.insert(rituals).values({
    id,
    userId,
    name: input.name,
    description: input.description ?? null,
    kind: input.kind,
    cadence: input.cadence ?? null,
    byWeekday: input.by_weekday ?? null,
    courseId: input.course_id ?? null,
    steps: input.steps ?? null,
    active: input.active ?? true,
  });
  return getRitual(db, userId, id);
}

export async function updateRitual(db: Db, userId: string, ritualId: string, input: UpdateRitualInput) {
  await requireOwnedRitual(db, userId, ritualId);
  if (input.course_id) await requireOwnedCourse(db, userId, input.course_id);

  const patch: Partial<typeof rituals.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.cadence !== undefined) patch.cadence = input.cadence;
  if (input.by_weekday !== undefined) patch.byWeekday = input.by_weekday;
  if (input.course_id !== undefined) patch.courseId = input.course_id;
  if (input.steps !== undefined) patch.steps = input.steps;
  if (input.active !== undefined) patch.active = input.active;

  if (Object.keys(patch).length > 0) {
    await db.update(rituals).set(patch).where(eq(rituals.id, ritualId));
  }
  return getRitual(db, userId, ritualId);
}

// Hard delete; cascades to tasks.ritual_id (cascade) / study_sessions.ritual_id
// (set null) per their FK onDelete, per docs/api.md.
export async function deleteRitual(db: Db, userId: string, ritualId: string): Promise<void> {
  await requireOwnedRitual(db, userId, ritualId);
  await db.delete(rituals).where(eq(rituals.id, ritualId));
}
