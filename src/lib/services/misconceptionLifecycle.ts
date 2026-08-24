// Deterministic learner-side lifecycle for known misconceptions. This is
// intentionally separate from tutor/UI code so diagnostic exercises and
// correction acceptance share one state transition implementation.
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, events, kcs, misconceptions, userMisconceptions } from '../../db/schema';
import type { AdvanceUserMisconceptionInput, UserMisconceptionStatus } from '../schemas/misconceptionLifecycle';
import { NotFoundError } from './util';

const STATUS_RANK: Record<UserMisconceptionStatus, number> = {
  suspected: 0,
  confirmed: 1,
  correcting: 2,
  internalized: 3,
};

type UserMisconceptionRow = typeof userMisconceptions.$inferSelect;

function evidenceIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

function timestampsFor(status: UserMisconceptionStatus, now: number) {
  const rank = STATUS_RANK[status];
  return {
    suspectedAt: now,
    confirmedAt: rank >= STATUS_RANK.confirmed ? now : null,
    correctingAt: rank >= STATUS_RANK.correcting ? now : null,
    internalizedAt: rank >= STATUS_RANK.internalized ? now : null,
  };
}

export async function requireOwnedMisconception(db: Db, userId: string, misconceptionId: string) {
  const rows = await db
    .select({ misconception: misconceptions, courseUserId: courses.userId })
    .from(misconceptions)
    .innerJoin(kcs, eq(misconceptions.kcId, kcs.id))
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(eq(misconceptions.id, misconceptionId))
    .limit(1);
  const row = rows[0];
  if (!row || row.courseUserId !== userId) throw new NotFoundError('Misconception');
  return row.misconception;
}

async function requireOwnedEvidenceEvent(db: Db, userId: string, eventId: string) {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Evidence event');
}

/**
 * Advances (never regresses) the lifecycle for one known misconception. A
 * requested later state fills all preceding transition timestamps so a tutor
 * correction may validly move a previously unseen misconception directly to
 * `correcting`: the proposal itself both confirms it and starts remediation.
 */
export async function advanceUserMisconception(
  db: Db,
  userId: string,
  input: AdvanceUserMisconceptionInput,
): Promise<UserMisconceptionRow> {
  await requireOwnedMisconception(db, userId, input.misconception_id);
  if (input.evidence_event_id) await requireOwnedEvidenceEvent(db, userId, input.evidence_event_id);

  const existingRows = await db
    .select()
    .from(userMisconceptions)
    .where(and(eq(userMisconceptions.userId, userId), eq(userMisconceptions.misconceptionId, input.misconception_id)))
    .limit(1);
  const existing = existingRows[0];
  const now = Date.now();

  if (!existing) {
    const id = crypto.randomUUID();
    await db.insert(userMisconceptions).values({
      id,
      userId,
      misconceptionId: input.misconception_id,
      status: input.status,
      evidenceEventIds: input.evidence_event_id ? [input.evidence_event_id] : [],
      ...timestampsFor(input.status, now),
      createdAt: now,
      updatedAt: now,
    });
    const rows = await db.select().from(userMisconceptions).where(eq(userMisconceptions.id, id)).limit(1);
    return rows[0]!;
  }

  const currentStatus = existing.status as UserMisconceptionStatus;
  const nextStatus = STATUS_RANK[input.status] > STATUS_RANK[currentStatus] ? input.status : currentStatus;
  const nextEvidenceIds = evidenceIds(existing.evidenceEventIds);
  if (input.evidence_event_id && !nextEvidenceIds.includes(input.evidence_event_id)) nextEvidenceIds.push(input.evidence_event_id);

  const targetTimestamps = timestampsFor(nextStatus, now);
  await db
    .update(userMisconceptions)
    .set({
      status: nextStatus,
      evidenceEventIds: nextEvidenceIds,
      suspectedAt: existing.suspectedAt ?? targetTimestamps.suspectedAt,
      confirmedAt: existing.confirmedAt ?? targetTimestamps.confirmedAt,
      correctingAt: existing.correctingAt ?? targetTimestamps.correctingAt,
      internalizedAt: existing.internalizedAt ?? targetTimestamps.internalizedAt,
      updatedAt: now,
    })
    .where(eq(userMisconceptions.id, existing.id));

  const rows = await db.select().from(userMisconceptions).where(eq(userMisconceptions.id, existing.id)).limit(1);
  return rows[0]!;
}

export async function listUserMisconceptions(db: Db, userId: string): Promise<UserMisconceptionRow[]> {
  return db
    .select()
    .from(userMisconceptions)
    .where(eq(userMisconceptions.userId, userId))
    .orderBy(asc(userMisconceptions.updatedAt));
}
