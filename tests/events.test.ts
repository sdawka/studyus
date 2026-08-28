import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, eventIdempotencyKeys, events, kcs, studySessionFinalizations, studySessions, users } from '../src/db/schema';
import {
  appendEventsAtomically,
  createEvent,
  deleteEvent,
  IdempotencyConflictError,
  listEvents,
  updateEvent,
} from '../src/lib/services/events';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let kcId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  kcId = crypto.randomUUID();

  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Test KC' });
});

describe('events service', () => {
  it('creates an event with role flags derived from type, and updates the KC mastery cache atomically', async () => {
    const { event, masteryDeltas } = await createEvent(db, userId, {
      type: 'quiz_taken',
      kc_id: kcId,
      course_id: courseId,
      payload: { correct: true },
    });

    expect(event.isAssessment).toBe(true);
    expect(event.isInstructional).toBe(false);
    expect(masteryDeltas).toHaveLength(1);
    expect(masteryDeltas[0].kc_id).toBe(kcId);
    expect(masteryDeltas[0].new_mastery).toBeGreaterThan(0);

    const kcRows = await db.select().from(kcs).where(eq(kcs.id, kcId)).limit(1);
    expect(kcRows[0].mastery).toBe(masteryDeltas[0].new_mastery);
    expect(kcRows[0].status).not.toBe('not-started');
  });

  it('rolls event and mastery writes back when a companion statement fails', async () => {
    const sessionId = crypto.randomUUID();
    await db.insert(studySessions).values({ id: sessionId, userId, courseId, intendedEventType: 'practice_done', startedAt: Date.now() });
    await db.insert(studySessionFinalizations).values({
      studySessionId: sessionId,
      disposition: 'completed',
      finalizedAt: Date.now(),
      createdAt: Date.now(),
    });

    await expect(appendEventsAtomically(db, userId, [{
      type: 'practice_done',
      kc_id: kcId,
      course_id: courseId,
      session_id: sessionId,
      payload: { session_id: sessionId, self_rating: 5 },
    }], 'session', [
      db.insert(studySessionFinalizations).values({
        studySessionId: sessionId,
        disposition: 'completed',
        finalizedAt: Date.now(),
        createdAt: Date.now(),
      }),
    ])).rejects.toThrow();

    expect(await db.select().from(events).where(eq(events.sessionId, sessionId))).toHaveLength(0);
    expect((await db.select().from(kcs).where(eq(kcs.id, kcId)))[0]).toMatchObject({ mastery: 0, status: 'not-started' });
  });

  it('a kc-less event does not require or touch a KC cache', async () => {
    const { event, masteryDeltas } = await createEvent(db, userId, {
      type: 'lecture_attended',
      course_id: courseId,
    });
    expect(event.kcId).toBeNull();
    expect(masteryDeltas).toHaveLength(0);
  });

  it('deduplicates a keyed event, including canonically equivalent payload and timestamp representations', async () => {
    const key = crypto.randomUUID();
    const first = await createEvent(
      db,
      userId,
      {
        type: 'quiz_taken',
        kc_id: kcId,
        course_id: courseId,
        ts: '2026-08-28T16:00:00.000Z',
        payload: { score: 80, nested: { beta: 2, alpha: 1 } },
      },
      'manual',
      key,
    );
    const replay = await createEvent(
      db,
      userId,
      {
        type: 'quiz_taken',
        kc_id: kcId,
        course_id: courseId,
        ts: '2026-08-28T12:00:00.000-04:00',
        payload: { nested: { alpha: 1, beta: 2 }, score: 80 },
      },
      'manual',
      key,
    );

    expect(first.wasCreated).toBe(true);
    expect(replay).toMatchObject({ wasCreated: false, masteryDeltas: [], event: { id: first.event.id } });
    expect(await db.select().from(events).where(eq(events.userId, userId))).toHaveLength(1);
    expect(await db.select().from(eventIdempotencyKeys).where(eq(eventIdempotencyKeys.userId, userId))).toHaveLength(1);
  });

  it('settles concurrent keyed deliveries to one event and one mastery fold', async () => {
    const key = crypto.randomUUID();
    const input = { type: 'quiz_taken' as const, kc_id: kcId, payload: { correct: true } };
    const [left, right] = await Promise.all([
      createEvent(db, userId, input, 'manual', key),
      createEvent(db, userId, input, 'manual', key),
    ]);

    expect([left.wasCreated, right.wasCreated].sort()).toEqual([false, true]);
    expect(left.event.id).toBe(right.event.id);
    expect(await db.select().from(events).where(eq(events.userId, userId))).toHaveLength(1);
  });

  it('scopes idempotency keys by learner', async () => {
    const key = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });

    const first = await createEvent(db, userId, { type: 'reading_done' }, 'manual', key);
    const second = await createEvent(db, otherUserId, { type: 'reading_done' }, 'manual', key);

    expect(first.event.id).not.toBe(second.event.id);
    expect(await db.select().from(eventIdempotencyKeys).where(eq(eventIdempotencyKeys.idempotencyKey, key))).toHaveLength(2);
  });

  it('rejects a reused key with changed evidence', async () => {
    const key = crypto.randomUUID();
    await createEvent(db, userId, { type: 'quiz_taken', kc_id: kcId, payload: { score: 80 } }, 'manual', key);

    await expect(
      createEvent(db, userId, { type: 'quiz_taken', kc_id: kcId, payload: { score: 81 } }, 'manual', key),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(await db.select().from(events).where(eq(events.userId, userId))).toHaveLength(1);
  });

  it('returns the current event after PATCH but leaves a tombstone after DELETE', async () => {
    const key = crypto.randomUUID();
    const input = { type: 'reading_done' as const, kc_id: kcId, payload: { note: 'Original' } };
    const created = await createEvent(db, userId, input, 'manual', key);
    await updateEvent(db, userId, created.event.id, { type: 'video_watched', payload: { note: 'Corrected' } });

    const replay = await createEvent(db, userId, input, 'manual', key);
    expect(replay).toMatchObject({
      wasCreated: false,
      masteryDeltas: [],
      event: { type: 'video_watched', payload: { note: 'Corrected' } },
    });

    await deleteEvent(db, userId, created.event.id);
    const [ledger] = await db
      .select()
      .from(eventIdempotencyKeys)
      .where(eq(eventIdempotencyKeys.idempotencyKey, key));
    expect(ledger.eventId).toBeNull();
    await expect(createEvent(db, userId, input, 'manual', key)).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(await db.select().from(events).where(eq(events.userId, userId))).toHaveLength(0);
  });

  it('tightens internal event_id retries across payload, course, timestamp, and source', async () => {
    const eventId = crypto.randomUUID();
    const base = {
      type: 'diagnostic_probe' as const,
      event_id: eventId,
      kc_id: kcId,
      course_id: courseId,
      ts: '2026-08-28T16:00:00.000Z',
      payload: { correct: true, channel: 'web' },
    };
    await createEvent(db, userId, base, 'tutor');

    const changed = [
      { ...base, payload: { correct: false, channel: 'web' } },
      { ...base, course_id: undefined },
      { ...base, ts: '2026-08-28T16:00:01.000Z' },
    ];
    for (const input of changed) {
      await expect(createEvent(db, userId, input, 'tutor')).rejects.toThrow('different evidence');
    }
    await expect(createEvent(db, userId, base, 'manual')).rejects.toThrow('different evidence');
  });

  it('settles concurrent internal event_id deliveries after the primary-key race', async () => {
    const input = {
      type: 'diagnostic_probe' as const,
      event_id: crypto.randomUUID(),
      kc_id: kcId,
      payload: { correct: false, channel: 'web' },
    };
    const [left, right] = await Promise.all([
      createEvent(db, userId, input, 'tutor'),
      createEvent(db, userId, input, 'tutor'),
    ]);

    expect([left.wasCreated, right.wasCreated].sort()).toEqual([false, true]);
    expect(left.event.id).toBe(right.event.id);
    expect(await db.select().from(events).where(eq(events.id, input.event_id))).toHaveLength(1);
  });

  it('records context-only events without changing a KC mastery cache or freshness', async () => {
    const evidence = await createEvent(db, userId, {
      type: 'quiz_taken',
      kc_id: kcId,
      payload: { correct: true },
    });
    const before = await db.select().from(kcs).where(eq(kcs.id, kcId)).limit(1);

    const context = await createEvent(db, userId, {
      type: 'correction_accepted',
      kc_id: kcId,
      payload: { correction_id: crypto.randomUUID() },
    });
    const after = await db.select().from(kcs).where(eq(kcs.id, kcId)).limit(1);

    expect(context.event.isAssessment).toBe(false);
    expect(context.event.isInstructional).toBe(false);
    expect(context.masteryDeltas[0]?.new_mastery).toBe(evidence.masteryDeltas[0].new_mastery);
    expect(after[0].mastery).toBe(before[0].mastery);
    expect(after[0].lastEventAt).toBe(before[0].lastEventAt);
  });

  it('deleting an event re-folds the KC from the remaining events', async () => {
    const first = await createEvent(db, userId, { type: 'quiz_taken', kc_id: kcId, payload: { correct: true } });
    const second = await createEvent(db, userId, { type: 'quiz_taken', kc_id: kcId, payload: { correct: true } });
    expect(second.masteryDeltas[0].new_mastery).toBeGreaterThanOrEqual(first.masteryDeltas[0].new_mastery);

    const { masteryDeltas } = await deleteEvent(db, userId, second.event.id);
    // After removing the second success, mastery should fall back toward the single-event level.
    expect(masteryDeltas[0].new_mastery).toBeLessThanOrEqual(second.masteryDeltas[0].new_mastery);

    const remaining = await listEvents(db, userId, { limit: 20 });
    expect(remaining.map((e) => e.id)).not.toContain(second.event.id);
    expect(remaining.map((e) => e.id)).toContain(first.event.id);
  });

  it('listEvents joins kc_name and filters on a from/to ts window', async () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const inWindow = await createEvent(db, userId, { type: 'lecture_attended', kc_id: kcId, ts: new Date(now).toISOString() });
    const outOfWindow = await createEvent(db, userId, { type: 'lecture_attended', kc_id: kcId, ts: new Date(now - 30 * dayMs).toISOString() });
    const noKc = await createEvent(db, userId, { type: 'reading_done', ts: new Date(now).toISOString() });

    const rows = await listEvents(db, userId, {
      from: new Date(now - dayMs).toISOString(),
      to: new Date(now + dayMs).toISOString(),
      limit: 50,
    });

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(inWindow.event.id);
    expect(ids).not.toContain(outOfWindow.event.id);
    expect(ids).toContain(noKc.event.id);

    const withKc = rows.find((r) => r.id === inWindow.event.id);
    expect(withKc?.kcName).toBe('Test KC');
    const withoutKc = rows.find((r) => r.id === noKc.event.id);
    expect(withoutKc?.kcName).toBeNull();
  });
});
