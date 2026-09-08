import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { studySessionTiming, users } from '../src/db/schema';
import { completeSession, createSession, discardSession, listSessions } from '../src/lib/services/sessions';
import { getSessionTiming, heartbeatSessionTiming, pauseSessionTiming, resumeSessionTiming, takeOverSessionTiming } from '../src/lib/services/sessionTiming';
import { ConflictError, NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);
const T0 = 1_800_000_000_000;

let userId: string;
let otherUserId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  otherUserId = crypto.randomUUID();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test.local`, passwordHash: 'x' },
    { id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' },
  ]);
});

async function session() {
  return createSession(db, userId, { intended_event_type: 'practice_done' });
}

describe('durable study timing', () => {
  it('creates new sessions paused with zero acknowledged duration', async () => {
    const created = await session();
    expect((await db.select().from(studySessionTiming).where(eq(studySessionTiming.sessionId, created.id)))[0]).toMatchObject({
      state: 'paused', elapsedMs: 0, sequence: 0, revision: 0,
    });
  });

  it('credits acknowledged server time once and rejects replayed sequence/revision', async () => {
    const created = await session();
    const resumed = await resumeSessionTiming(db, userId, created.id, { deviceId: 'device-a' }, T0);
    const heartbeat = await heartbeatSessionTiming(db, userId, created.id, {
      deviceId: 'device-a', leaseToken: resumed.leaseToken!, sequence: 1, revision: resumed.revision,
    }, T0 + 15_000);

    expect(heartbeat).toMatchObject({ state: 'running', elapsedMs: 15_000, sequence: 1 });
    await expect(heartbeatSessionTiming(db, userId, created.id, {
      deviceId: 'device-a', leaseToken: resumed.leaseToken!, sequence: 1, revision: resumed.revision,
    }, T0 + 16_000)).rejects.toThrow(ConflictError);
    expect((await db.select().from(studySessionTiming).where(eq(studySessionTiming.sessionId, created.id)))[0]?.elapsedMs).toBe(15_000);
  });

  it('uses the revision fence when concurrent heartbeats race', async () => {
    const created = await session();
    const resumed = await resumeSessionTiming(db, userId, created.id, { deviceId: 'device-a' }, T0);
    const input = { deviceId: 'device-a', leaseToken: resumed.leaseToken!, sequence: 1, revision: resumed.revision };
    const results = await Promise.allSettled([
      heartbeatSessionTiming(db, userId, created.id, input, T0 + 15_000),
      heartbeatSessionTiming(db, userId, created.id, input, T0 + 15_000),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await db.select().from(studySessionTiming).where(eq(studySessionTiming.sessionId, created.id)))[0]).toMatchObject({ elapsedMs: 15_000, sequence: 1 });
  });

  it('credits no stale offline gap and pauses the lease', async () => {
    const created = await session();
    const resumed = await resumeSessionTiming(db, userId, created.id, { deviceId: 'device-a' }, T0);
    const result = await heartbeatSessionTiming(db, userId, created.id, {
      deviceId: 'device-a', leaseToken: resumed.leaseToken!, sequence: 1, revision: resumed.revision,
    }, T0 + 86_400_000);

    expect(result).toMatchObject({ state: 'paused', elapsedMs: 0 });
  });

  it('requires explicit takeover when another device owns the active lease', async () => {
    const created = await session();
    const first = await resumeSessionTiming(db, userId, created.id, { deviceId: 'device-a' }, T0);

    await expect(resumeSessionTiming(db, userId, created.id, { deviceId: 'device-b' }, T0 + 1)).rejects.toThrow(ConflictError);
    const taken = await takeOverSessionTiming(db, userId, created.id, { deviceId: 'device-b' }, T0 + 1);
    expect(taken).toMatchObject({ state: 'running', deviceId: 'device-b' });
    await expect(pauseSessionTiming(db, userId, created.id, {
      deviceId: 'device-a', leaseToken: first.leaseToken!, sequence: 1, revision: first.revision,
    }, T0 + 2)).rejects.toThrow(ConflictError);
  });

  it('allows only one running session per learner until an explicit takeover', async () => {
    const first = await session();
    const second = await session();
    await resumeSessionTiming(db, userId, first.id, { deviceId: 'device-a' }, T0);

    await expect(resumeSessionTiming(db, userId, second.id, { deviceId: 'device-a' }, T0 + 1)).rejects.toThrow(ConflictError);
    const taken = await takeOverSessionTiming(db, userId, second.id, { deviceId: 'device-a' }, T0 + 1);
    expect(taken.sessionId).toBe(second.id);
    expect((await getSessionTiming(db, userId, first.id)).state).toBe('paused');
  });

  it('maps the one-running-session unique-index race to a takeover conflict', async () => {
    const first = await session();
    const second = await session();
    const results = await Promise.allSettled([
      resumeSessionTiming(db, userId, first.id, { deviceId: 'device-a' }, T0),
      resumeSessionTiming(db, userId, second.id, { deviceId: 'device-b' }, T0),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(ConflictError) });
    expect(await db.select().from(studySessionTiming).where(and(eq(studySessionTiming.userId, userId), eq(studySessionTiming.state, 'running')))).toHaveLength(1);
  });

  it('reports legacy open sessions as recovery with unknown elapsed time', async () => {
    const created = await session();
    await db.delete(studySessionTiming).where(eq(studySessionTiming.sessionId, created.id));

    await expect(getSessionTiming(db, userId, created.id)).resolves.toMatchObject({ state: 'paused', elapsedMs: null, recovery: true });
    expect((await listSessions(db, userId, {})).find((item) => item.id === created.id)?.timing).toBeNull();
  });

  it('404s for foreign or inactive learners without starting a timer', async () => {
    const created = await session();
    await expect(resumeSessionTiming(db, otherUserId, created.id, { deviceId: 'device-b' }, T0)).rejects.toThrow(NotFoundError);
    await db.update(users).set({ accountState: 'deleting' }).where(eq(users.id, userId));
    await expect(resumeSessionTiming(db, userId, created.id, { deviceId: 'device-a' }, T0)).rejects.toThrow(NotFoundError);
    expect(await db.select().from(studySessionTiming).where(and(eq(studySessionTiming.sessionId, created.id), eq(studySessionTiming.state, 'running')))).toEqual([]);
  });

  it('ends timing in the same terminal finalization and stays terminal on retry', async () => {
    const created = await session();
    const resumed = await resumeSessionTiming(db, userId, created.id, { deviceId: 'device-a' }, T0);
    await heartbeatSessionTiming(db, userId, created.id, {
      deviceId: 'device-a', leaseToken: resumed.leaseToken!, sequence: 1, revision: resumed.revision,
    }, T0 + 15_000);

    await completeSession(db, userId, created.id, { kc_outcomes: [] });
    expect((await db.select().from(studySessionTiming).where(eq(studySessionTiming.sessionId, created.id)))[0]).toMatchObject({ state: 'ended', elapsedMs: 15_000 });
    await expect(completeSession(db, userId, created.id, { kc_outcomes: [] })).resolves.toMatchObject({ alreadyFinalized: true });
    await expect(discardSession(db, userId, created.id, {})).rejects.toThrow(ConflictError);
  });
});
