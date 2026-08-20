import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { courses, rituals, studySessions, tasks, users } from '../src/db/schema';
import { localNoon } from '../src/lib/services/classSessions';
import {
  createRitual,
  deleteRitual,
  getRitual,
  listRitualsWithAdherence,
  listSessionShapeRituals,
  requireOwnedRitual,
  updateRitual,
} from '../src/lib/services/rituals';
import { NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);
const DAY_MS = 24 * 60 * 60 * 1000;

let userId: string;
let courseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
});

function yyyymmdd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

describe('createRitual / getRitual / updateRitual / deleteRitual', () => {
  it('creates a recurring ritual and returns it with an empty adherence block', async () => {
    const created = await createRitual(db, userId, { name: 'Weekly review', kind: 'recurring', cadence: 'weekly', by_weekday: '[1]' });
    expect(created.name).toBe('Weekly review');
    expect(created.kind).toBe('recurring');
    expect(created.byWeekday).toBe('[1]');
    expect(created.active).toBe(true);
    expect(created.adherence).toEqual({ done_28d: 0, generated_28d: 0, session_uses_28d: 0, occurrences: [] });
  });

  it('rejects a course_id that does not belong to the caller', async () => {
    const otherUserId = crypto.randomUUID();
    const otherCourseId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'X 1', slug: `other-${otherCourseId}`, title: 'Other' });

    await expect(
      createRitual(db, userId, { name: 'Before class prep', kind: 'recurring', cadence: 'before_class', course_id: otherCourseId }),
    ).rejects.toThrow(NotFoundError);
  });

  it('updates fields, including nulling out cadence/course_id/steps', async () => {
    const created = await createRitual(db, userId, {
      name: 'Session shape',
      kind: 'both',
      cadence: 'daily',
      course_id: courseId,
      steps: [{ kind: 'warmup', minutes: 5 }],
    });

    const updated = await updateRitual(db, userId, created.id, { cadence: null, course_id: null, steps: null, active: false });
    expect(updated.cadence).toBeNull();
    expect(updated.courseId).toBeNull();
    expect(updated.steps).toBeNull();
    expect(updated.active).toBe(false);
    expect(updated.name).toBe('Session shape');
  });

  it('404s updating/deleting/getting a ritual owned by another user', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    const theirs = await createRitual(db, otherUserId, { name: 'Not yours', kind: 'recurring', cadence: 'daily' });

    await expect(getRitual(db, userId, theirs.id)).rejects.toThrow(NotFoundError);
    await expect(updateRitual(db, userId, theirs.id, { name: 'Hijacked' })).rejects.toThrow(NotFoundError);
    await expect(deleteRitual(db, userId, theirs.id)).rejects.toThrow(NotFoundError);
    await expect(requireOwnedRitual(db, userId, theirs.id)).rejects.toThrow(NotFoundError);
  });

  it('hard deletes and cascades to its tasks', async () => {
    const created = await createRitual(db, userId, { name: 'Daily flashcards', kind: 'recurring', cadence: 'daily' });
    const now = Date.now();
    await db.insert(tasks).values({
      id: crypto.randomUUID(),
      userId,
      title: created.name,
      type: 'ritual',
      dueDate: localNoon(now),
      ritualId: created.id,
      source: 'system',
      dedupeKey: `ritual:${created.id}:${yyyymmdd(localNoon(now))}`,
      createdAt: now,
    });

    await deleteRitual(db, userId, created.id);
    const remainingRituals = await db.select().from(rituals).where(eq(rituals.id, created.id));
    expect(remainingRituals).toHaveLength(0);
    const remainingTasks = await db.select().from(tasks).where(eq(tasks.ritualId, created.id));
    expect(remainingTasks).toHaveLength(0);
  });
});

describe('listRitualsWithAdherence', () => {
  it('computes done/generated/occurrences for a recurring ritual from its sweep-minted tasks', async () => {
    const created = await createRitual(db, userId, { name: 'Weekly review', kind: 'recurring', cadence: 'weekly', by_weekday: '[1]' });
    const now = Date.now();
    const today = localNoon(now);

    // A done occurrence a week ago, a dismissed ("skipped") occurrence two
    // weeks ago, and an open ("upcoming") occurrence due later today.
    await db.insert(tasks).values([
      {
        id: crypto.randomUUID(),
        userId,
        title: created.name,
        type: 'ritual',
        dueDate: today - 7 * DAY_MS,
        done: true,
        ritualId: created.id,
        source: 'system',
        dedupeKey: `ritual:${created.id}:${yyyymmdd(today - 7 * DAY_MS)}`,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        userId,
        title: created.name,
        type: 'ritual',
        dueDate: today - 14 * DAY_MS,
        dismissedAt: now,
        ritualId: created.id,
        source: 'system',
        dedupeKey: `ritual:${created.id}:${yyyymmdd(today - 14 * DAY_MS)}`,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        userId,
        title: created.name,
        type: 'ritual',
        dueDate: today + DAY_MS,
        ritualId: created.id,
        source: 'system',
        dedupeKey: `ritual:${created.id}:${yyyymmdd(today + DAY_MS)}`,
        createdAt: now,
      },
      // Outside the trailing 28-day window — must not count.
      {
        id: crypto.randomUUID(),
        userId,
        title: created.name,
        type: 'ritual',
        dueDate: today - 40 * DAY_MS,
        done: true,
        ritualId: created.id,
        source: 'system',
        dedupeKey: `ritual:${created.id}:${yyyymmdd(today - 40 * DAY_MS)}`,
        createdAt: now,
      },
    ]);

    const list = await listRitualsWithAdherence(db, userId, now);
    expect(list).toHaveLength(1);
    const adherence = list[0].adherence;
    expect(adherence.generated_28d).toBe(3);
    expect(adherence.done_28d).toBe(1);
    expect(adherence.occurrences.map((o) => o.state)).toEqual(['skipped', 'done', 'upcoming']);
    expect(adherence.session_uses_28d).toBe(0);
  });

  it('marks a not-done, past-due occurrence as skipped even without an explicit dismissal', async () => {
    const created = await createRitual(db, userId, { name: 'Daily habit', kind: 'recurring', cadence: 'daily' });
    const now = Date.now();
    const today = localNoon(now);

    await db.insert(tasks).values({
      id: crypto.randomUUID(),
      userId,
      title: created.name,
      type: 'ritual',
      dueDate: today - 2 * DAY_MS,
      ritualId: created.id,
      source: 'system',
      dedupeKey: `ritual:${created.id}:${yyyymmdd(today - 2 * DAY_MS)}`,
      createdAt: now,
    });

    const ritual = await getRitual(db, userId, created.id, now);
    expect(ritual.adherence.occurrences).toEqual([{ date: expect.any(String), state: 'skipped' }]);
  });

  it('counts session_uses_28d from study_sessions.ritual_id for a session_shape ritual, ignoring task-based adherence', async () => {
    const created = await createRitual(db, userId, { name: 'Pomodoro shape', kind: 'session_shape', steps: [{ kind: 'warmup', minutes: 5 }] });
    const now = Date.now();

    await db.insert(studySessions).values([
      { id: crypto.randomUUID(), userId, intendedEventType: 'practice_done', startedAt: now - DAY_MS, ritualId: created.id },
      { id: crypto.randomUUID(), userId, intendedEventType: 'practice_done', startedAt: now - 40 * DAY_MS, ritualId: created.id },
    ]);

    const ritual = await getRitual(db, userId, created.id, now);
    expect(ritual.adherence.session_uses_28d).toBe(1);
    expect(ritual.adherence.generated_28d).toBe(0);
    expect(ritual.adherence.occurrences).toEqual([]);
  });

  it('scopes strictly to the caller', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await createRitual(db, otherUserId, { name: 'Not mine', kind: 'recurring', cadence: 'daily' });
    await createRitual(db, userId, { name: 'Mine', kind: 'recurring', cadence: 'daily' });

    const list = await listRitualsWithAdherence(db, userId);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Mine');
  });
});

describe('listSessionShapeRituals', () => {
  it('lists only active session_shape/both rituals, excluding plain recurring and inactive ones', async () => {
    const shape = await createRitual(db, userId, { name: 'Shape', kind: 'session_shape', steps: [{ kind: 'reflect' }] });
    await createRitual(db, userId, { name: 'Both', kind: 'both', cadence: 'daily', steps: [{ kind: 'game' }] });
    await createRitual(db, userId, { name: 'Recurring only', kind: 'recurring', cadence: 'daily' });
    const inactive = await createRitual(db, userId, { name: 'Inactive shape', kind: 'session_shape', active: false });
    await updateRitual(db, userId, inactive.id, { active: false });

    const list = await listSessionShapeRituals(db, userId);
    expect(list.map((r) => r.name).sort()).toEqual(['Both', 'Shape']);
    const shapeRow = list.find((r) => r.id === shape.id)!;
    expect(shapeRow.steps).toEqual([{ kind: 'reflect' }]);
  });
});
