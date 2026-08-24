// Assistant-coach admin engine.  Its output is channel-neutral and can be
// rendered as a web card, notification, or future digest.
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { DomainContext } from '../context';
import { courses, kcs } from '../../../db/schema';
import { getLearnerProfile } from '../learner/profile';

export async function getReviewQueue(ctx: DomainContext, limit = 10) {
  const rows = await ctx.db
    .select({ kcId: kcs.id, kcName: kcs.name, mastery: kcs.mastery, lastEventAt: kcs.lastEventAt, courseId: courses.id, courseTitle: courses.title })
    .from(kcs)
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(eq(courses.userId, ctx.userId), eq(courses.archived, false), isNotNull(kcs.lastEventAt)))
    .orderBy(asc(kcs.mastery), asc(kcs.lastEventAt))
    .limit(limit);
  return rows;
}

export async function buildProgressDigest(ctx: DomainContext) {
  const [profile, reviewQueue] = await Promise.all([getLearnerProfile(ctx), getReviewQueue(ctx, 3)]);
  return {
    generated_at: new Date(ctx.now ?? Date.now()).toISOString(),
    overall_mastery: profile.overall_mastery,
    review_queue: reviewQueue,
    frontier_count: profile.frontier.counts.frontier,
    // The orchestrator narrates this informationally; no streak/guilt copy is
    // embedded in the engine output.
    next_step: reviewQueue[0] ? `Review ${reviewQueue[0].kcName}` : 'Choose a frontier topic to explore',
  };
}
