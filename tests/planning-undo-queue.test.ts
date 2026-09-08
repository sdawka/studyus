import { env } from 'cloudflare:test';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { planningJobs, planningPreferences, planningRuns, studySessions, tasks, users } from '../src/db/schema';
import { applyPlan, previewPlan, processPlanningJobs, undoPlan, updatePlanningPreferences } from '../src/lib/services/planning';

const db = getDb(env.DB);
const NOW = Date.parse('2027-01-04T13:00:00.000Z');

describe('planning undo queue suppression', () => {
  it('does not immediately reapply an undone manual plan and still queues later source changes', async () => {
    const userId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    await db.insert(users).values({
      id: userId,
      email: `${userId}@test.local`,
      passwordHash: 'x',
      timezone: 'America/Toronto',
    });
    await db.insert(tasks).values({
      id: taskId,
      userId,
      title: 'Read chapter',
      estimatedMinutes: 25,
      priority: 1,
    });

    const preference = await updatePlanningPreferences(db, userId, {
      enabled: true,
      weeklyMinutes: 420,
      availability: [{ day: 1, startMinute: 540, endMinute: 1020 }],
      timezone: 'America/Toronto',
      expectedRevision: 0,
    }, NOW);
    expect(await db.select().from(planningJobs).where(eq(planningJobs.userId, userId))).toHaveLength(1);

    const preview = await previewPlan(db, userId, NOW);
    await applyPlan(db, userId, preview.id, preference.revision, NOW + 1);
    await undoPlan(db, userId, preview.id, NOW + 2);

    expect(await db.select().from(planningJobs).where(eq(planningJobs.userId, userId))).toEqual([]);
    expect((await db.select().from(planningPreferences).where(eq(planningPreferences.userId, userId)))[0])
      .toMatchObject({ enabled: true, nextReviewAt: NOW + 2 + 86_400_000 });

    await expect(processPlanningJobs(db, { now: NOW + 60_000 })).resolves.toEqual({ processed: 0, applied: 0 });
    expect(await db.select().from(studySessions).where(eq(studySessions.userId, userId))).toEqual([]);
    expect(await db.select().from(planningRuns).where(and(eq(planningRuns.userId, userId), eq(planningRuns.status, 'applied')))).toEqual([]);

    await db.update(tasks).set({ priority: 2 }).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
    expect(await db.select().from(planningJobs).where(eq(planningJobs.userId, userId))).toEqual([
      expect.objectContaining({ userId, attemptCount: 0 }),
    ]);
  });
});
