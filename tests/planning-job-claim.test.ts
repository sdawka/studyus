import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { planningJobs, planningPreferences, planningRuns, studySessions, tasks, users } from '../src/db/schema';
import { processPlanningJobs, updatePlanningPreferences } from '../src/lib/services/planning';

const db = getDb(env.DB);
const NOW = Date.parse('2027-01-04T13:00:00.000Z');
const CLAIM_LEASE_MS = 5 * 60_000;

beforeEach(async () => {
  await db.delete(planningRuns);
  await db.delete(planningJobs);
  await db.delete(planningPreferences);
  await db.delete(studySessions);
  await db.delete(tasks);
  await db.delete(users);
});

async function queuedPlanner(title: string) {
  const userId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  await db.insert(users).values({
    id: userId,
    email: `${userId}@test.local`,
    passwordHash: 'x',
    timezone: 'America/Toronto',
  });
  await db.insert(tasks).values({ id: taskId, userId, title, estimatedMinutes: 25, priority: 1 });
  await updatePlanningPreferences(db, userId, {
    enabled: true,
    weeklyMinutes: 420,
    availability: [{ day: 1, startMinute: 540, endMinute: 1020 }],
    timezone: 'America/Toronto',
    expectedRevision: 0,
  }, NOW);
  return { userId, taskId };
}

describe('planning job claims', () => {
  it('lets only one overlapping processor claim and apply a queued plan', async () => {
    const { userId } = await queuedPlanner('Concurrent planning');

    const results = await Promise.all([
      processPlanningJobs(db, { now: NOW, limit: 1 }),
      processPlanningJobs(db, { now: NOW, limit: 1 }),
    ]);

    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.applied, 0)).toBe(1);
    expect(await db.select().from(planningRuns).where(and(eq(planningRuns.userId, userId), eq(planningRuns.status, 'applied')))).toHaveLength(1);
    expect(await db.select().from(studySessions).where(eq(studySessions.userId, userId))).toHaveLength(1);
  });

  it('does not let a failed claimed attempt overwrite a source-triggered replacement job', async () => {
    const { userId, taskId } = await queuedPlanner('Replacement work');
    await env.DB.prepare(`
      CREATE TRIGGER planning_claim_test_requeue AFTER INSERT ON planning_runs
      BEGIN
        UPDATE tasks SET priority=2 WHERE id='${taskId}';
      END
    `).run();
    try {
      await expect(processPlanningJobs(db, { now: NOW, limit: 1 })).resolves.toEqual({ processed: 1, applied: 0 });
    } finally {
      await env.DB.exec('DROP TRIGGER planning_claim_test_requeue');
    }

    const replacement = (await db.select().from(planningJobs).where(eq(planningJobs.userId, userId)))[0]!;
    expect(replacement).toMatchObject({ attemptCount: 0 });
    expect(replacement.version).toBeGreaterThanOrEqual(2);
    expect((await db.select().from(planningPreferences).where(eq(planningPreferences.userId, userId)))[0]!.revision).toBeGreaterThan(1);
  });

  it('skips an unexpired claim and recovers it after its lease', async () => {
    const { userId } = await queuedPlanner('Crash recovery');
    await db.update(planningJobs).set({ version: 1, availableAt: NOW + CLAIM_LEASE_MS }).where(eq(planningJobs.userId, userId));

    await expect(processPlanningJobs(db, { now: NOW + CLAIM_LEASE_MS - 1, limit: 1 })).resolves.toEqual({ processed: 0, applied: 0 });
    await expect(processPlanningJobs(db, { now: NOW + CLAIM_LEASE_MS, limit: 1 })).resolves.toEqual({ processed: 1, applied: 1 });
    expect(await db.select().from(planningJobs).where(eq(planningJobs.userId, userId))).toEqual([]);
  });
});
