import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { courses } from '../src/db/schema';
import { resolveLocalUser } from '../src/lib/auth/local-user';
import { getCourseDomain } from '../src/lib/services/courseDraft';
import { respondToExperience } from '../src/lib/services/events';
import { getNextMove } from '../src/lib/services/nextMove';

const db = getDb(env.DB);
async function learner() {
  const id = crypto.randomUUID();
  return resolveLocalUser(db, { id: `clerk-next-${id}`, primaryEmailAddress: `${id}@next.test` });
}

describe('next move for a new learner', () => {
  it('opens a real owned module activity without requiring the AI tutor', async () => {
    const owner = await learner();
    const other = await learner();
    const domain = await getCourseDomain(db, owner.user.id, owner.defaultCourse!.id);
    const foreign = await getCourseDomain(db, other.user.id, other.defaultCourse!.id);
    const result = await getNextMove(db, owner.user.id);
    const moves = [result.recommendation!, ...result.alternatives];
    expect(result.recommendation).not.toBeNull();
    for (const move of moves) {
      expect(move.activity).toBeDefined();
      const activity = domain.experiences.find((row) => row.id === move.activity!.experience_id)!;
      expect(activity.target_kc_ids).toContain(move.kc.kc_id);
      expect(domain.modules.some((module) => module.experience_ids.includes(activity.id))).toBe(true);
      expect(move.action_href).toBe(`/courses/${owner.defaultCourse!.slug}#experience-${activity.id}`);
      expect(foreign.experiences.some((row) => row.id === activity.id)).toBe(false);
      expect(move.activity).toEqual({ experience_id: activity.id, kind: activity.kind });
    }
  });

  it('offers the next unrecorded activity after reading an explanation', async () => {
    const owner = await learner();
    const first = (await getNextMove(db, owner.user.id)).recommendation!;
    expect(first.activity?.kind).toBe('scaffold');
    await respondToExperience(db, owner.user.id, first.activity!.experience_id, { response: 'Explanation read' });
    const next = (await getNextMove(db, owner.user.id)).recommendation!;
    expect(next.activity).toBeDefined();
    expect(next.activity!.experience_id).not.toBe(first.activity!.experience_id);
    expect(next.activity!.kind).toBe('exercise');
  });

  it('does not recommend activities in archived courses', async () => {
    const owner = await learner();
    await db.update(courses).set({ archived: true }).where(eq(courses.id, owner.defaultCourse!.id));
    expect((await getNextMove(db, owner.user.id)).recommendation).toBeNull();
  });
});
