import { and, eq, lt, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { studySessionTiming, studySessions, users } from '../../db/schema';
import { ConflictError, NotFoundError } from './util';

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const LEASE_MS = 45_000;
export const MAX_CREDIT_GAP_MS = 30_000;

type TimingRow = typeof studySessionTiming.$inferSelect;

export type TimingLeaseInput = {
  deviceId: string;
  leaseToken: string;
  sequence: number;
  revision: number;
};

function view(row: TimingRow, recovery = false, leaseToken?: string) {
  return {
    sessionId: row.sessionId,
    state: row.state,
    elapsedMs: recovery ? null : row.elapsedMs,
    deviceId: row.state === 'running' ? row.deviceId : null,
    sequence: row.sequence,
    revision: row.revision,
    lastAckAt: row.lastAckAt,
    leaseExpiresAt: row.leaseExpiresAt,
    recovery,
    ...(leaseToken ? { leaseToken } : {}),
  };
}

async function requireActiveOwnedOpenSession(db: Db, userId: string, sessionId: string) {
  const rows = await db
    .select({ id: studySessions.id, endedAt: studySessions.endedAt })
    .from(studySessions)
    .innerJoin(users, eq(studySessions.userId, users.id))
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId), eq(users.accountState, 'active')))
    .limit(1);
  const session = rows[0];
  if (!session) throw new NotFoundError('Study session');
  if (session.endedAt !== null) throw new ConflictError('Study session already ended');
}

async function loadTiming(db: Db, sessionId: string) {
  const rows = await db.select().from(studySessionTiming).where(eq(studySessionTiming.sessionId, sessionId)).limit(1);
  return rows[0] ?? null;
}

async function ensureTiming(db: Db, userId: string, sessionId: string, now: number) {
  await db
    .insert(studySessionTiming)
    .values({ sessionId, userId, state: 'paused', elapsedMs: 0, sequence: 0, revision: 0, updatedAt: now })
    .onConflictDoNothing();
  const timing = await loadTiming(db, sessionId);
  if (!timing) throw new ConflictError('Could not initialize study timing');
  return timing;
}

async function assertLease(timing: TimingRow, input: TimingLeaseInput) {
  if (
    timing.state !== 'running' ||
    timing.deviceId !== input.deviceId ||
    timing.leaseToken !== input.leaseToken ||
    timing.revision !== input.revision ||
    input.sequence <= timing.sequence
  ) {
    throw new ConflictError('Study timer lease is no longer current');
  }
}

async function startPausedTiming(db: Db, timing: TimingRow, deviceId: string, now: number) {
  const leaseToken = crypto.randomUUID();
  const changed = await db
    .update(studySessionTiming)
    .set({
      state: 'running',
      deviceId,
      leaseToken,
      lastAckAt: now,
      leaseExpiresAt: now + LEASE_MS,
      revision: timing.revision + 1,
      updatedAt: now,
    })
    .where(and(eq(studySessionTiming.sessionId, timing.sessionId), eq(studySessionTiming.state, 'paused'), eq(studySessionTiming.revision, timing.revision)));
  if (changed.meta.changes !== 1) throw new ConflictError('Study timer changed in another device');
  const next = await loadTiming(db, timing.sessionId);
  if (!next) throw new ConflictError('Study timer disappeared');
  return view(next, false, leaseToken);
}

function isOneRunningTimerConstraint(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (message.includes('UNIQUE constraint failed') && message.includes('study_session_timing.user_id')) return true;
    current = 'cause' in current ? current.cause : null;
  }
  return false;
}

export async function getSessionTiming(db: Db, userId: string, sessionId: string) {
  await requireActiveOwnedOpenSession(db, userId, sessionId);
  const timing = await loadTiming(db, sessionId);
  if (!timing) {
    return { sessionId, state: 'paused' as const, elapsedMs: null, deviceId: null, sequence: 0, revision: 0, lastAckAt: null, leaseExpiresAt: null, recovery: true };
  }
  return view(timing);
}

export async function resumeSessionTiming(
  db: Db,
  userId: string,
  sessionId: string,
  input: { deviceId: string; leaseToken?: string },
  now = Date.now(),
) {
  await requireActiveOwnedOpenSession(db, userId, sessionId);
  let timing = await ensureTiming(db, userId, sessionId, now);

  if (timing.state === 'running') {
    if (timing.leaseExpiresAt !== null && timing.leaseExpiresAt <= now) {
      const expired = await db
        .update(studySessionTiming)
        .set({ state: 'paused', deviceId: null, leaseToken: null, leaseExpiresAt: null, revision: timing.revision + 1, updatedAt: now })
        .where(and(eq(studySessionTiming.sessionId, sessionId), eq(studySessionTiming.state, 'running'), eq(studySessionTiming.revision, timing.revision), lt(studySessionTiming.leaseExpiresAt, now + 1)));
      if (expired.meta.changes !== 1) throw new ConflictError('Study timer changed in another device');
      timing = await ensureTiming(db, userId, sessionId, now);
    } else if (timing.deviceId === input.deviceId && timing.leaseToken === input.leaseToken) {
      return view(timing, false, timing.leaseToken ?? undefined);
    } else {
      throw new ConflictError('Another device is actively studying. Take over to continue.');
    }
  }

  const activeElsewhere = await db
    .select({ sessionId: studySessionTiming.sessionId })
    .from(studySessionTiming)
    .where(and(eq(studySessionTiming.userId, userId), eq(studySessionTiming.state, 'running'), ne(studySessionTiming.sessionId, sessionId)))
    .limit(1);
  if (activeElsewhere[0]) throw new ConflictError('Another study session is active. Take over to continue.');
  try {
    return await startPausedTiming(db, timing, input.deviceId, now);
  } catch (error) {
    if (isOneRunningTimerConstraint(error)) {
      throw new ConflictError('Another study session is active. Take over to continue.');
    }
    throw error;
  }
}

export async function heartbeatSessionTiming(db: Db, userId: string, sessionId: string, input: TimingLeaseInput, now = Date.now()) {
  await requireActiveOwnedOpenSession(db, userId, sessionId);
  const timing = await loadTiming(db, sessionId);
  if (!timing) throw new ConflictError('Study timer has not started');
  await assertLease(timing, input);

  const gap = timing.lastAckAt === null ? 0 : now - timing.lastAckAt;
  const current = gap >= 0 && gap <= MAX_CREDIT_GAP_MS;
  const changed = await db
    .update(studySessionTiming)
    .set({
      elapsedMs: timing.elapsedMs + (current ? gap : 0),
      state: current ? 'running' : 'paused',
      deviceId: current ? input.deviceId : null,
      leaseToken: current ? input.leaseToken : null,
      lastAckAt: now,
      leaseExpiresAt: current ? now + LEASE_MS : null,
      sequence: input.sequence,
      revision: timing.revision + 1,
      updatedAt: now,
    })
    .where(and(eq(studySessionTiming.sessionId, sessionId), eq(studySessionTiming.revision, timing.revision), eq(studySessionTiming.leaseToken, input.leaseToken)));
  if (changed.meta.changes !== 1) throw new ConflictError('Study timer changed in another device');
  const next = await loadTiming(db, sessionId);
  if (!next) throw new ConflictError('Study timer disappeared');
  return view(next, false, current ? input.leaseToken : undefined);
}

export async function pauseSessionTiming(db: Db, userId: string, sessionId: string, input: TimingLeaseInput, now = Date.now()) {
  await requireActiveOwnedOpenSession(db, userId, sessionId);
  const timing = await loadTiming(db, sessionId);
  if (!timing) throw new ConflictError('Study timer has not started');
  await assertLease(timing, input);
  const gap = timing.lastAckAt === null ? 0 : now - timing.lastAckAt;
  const credit = gap >= 0 && gap <= MAX_CREDIT_GAP_MS ? gap : 0;
  const changed = await db
    .update(studySessionTiming)
    .set({
      elapsedMs: timing.elapsedMs + credit,
      state: 'paused',
      deviceId: null,
      leaseToken: null,
      lastAckAt: now,
      leaseExpiresAt: null,
      sequence: input.sequence,
      revision: timing.revision + 1,
      updatedAt: now,
    })
    .where(and(eq(studySessionTiming.sessionId, sessionId), eq(studySessionTiming.revision, timing.revision), eq(studySessionTiming.leaseToken, input.leaseToken)));
  if (changed.meta.changes !== 1) throw new ConflictError('Study timer changed in another device');
  const next = await loadTiming(db, sessionId);
  if (!next) throw new ConflictError('Study timer disappeared');
  return view(next);
}

export async function takeOverSessionTiming(db: Db, userId: string, sessionId: string, input: { deviceId: string }, now = Date.now()) {
  await requireActiveOwnedOpenSession(db, userId, sessionId);
  const timing = await ensureTiming(db, userId, sessionId, now);
  if (timing.state === 'ended') throw new ConflictError('Study timer already ended');
  const leaseToken = crypto.randomUUID();
  const stoppedOthers = db
    .update(studySessionTiming)
    .set({ state: 'paused', deviceId: null, leaseToken: null, leaseExpiresAt: null, revision: sql`${studySessionTiming.revision} + 1`, updatedAt: now })
    .where(and(eq(studySessionTiming.userId, userId), eq(studySessionTiming.state, 'running'), ne(studySessionTiming.sessionId, sessionId)));
  const started = db
    .update(studySessionTiming)
    .set({ state: 'running', deviceId: input.deviceId, leaseToken, lastAckAt: now, leaseExpiresAt: now + LEASE_MS, revision: timing.revision + 1, updatedAt: now })
    .where(and(eq(studySessionTiming.sessionId, sessionId), eq(studySessionTiming.revision, timing.revision)));
  const results = await db.batch([stoppedOthers, started]);
  if (results[1].meta.changes !== 1) throw new ConflictError('Study timer changed in another device');
  const next = await loadTiming(db, sessionId);
  if (!next) throw new ConflictError('Study timer disappeared');
  return view(next, false, leaseToken);
}
