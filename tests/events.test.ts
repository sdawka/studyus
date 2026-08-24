import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, kcs, users } from '../src/db/schema';
import { createEvent, deleteEvent, listEvents } from '../src/lib/services/events';

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

  it('a kc-less event does not require or touch a KC cache', async () => {
    const { event, masteryDeltas } = await createEvent(db, userId, {
      type: 'lecture_attended',
      course_id: courseId,
    });
    expect(event.kcId).toBeNull();
    expect(masteryDeltas).toHaveLength(0);
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
