// The learner profile is the only broad learner-plane read surface exposed to
// pedagogy.  Engines must not independently stitch raw course/KC/event tables.
import type { DomainContext } from '../context';
import { getProfile } from '../../services/profile';
import { getGlobalFrontier } from '../../services/zpd';
import { getMetaSkills, listCapabilities } from '../../services/capabilities';

export async function getLearnerProfile(ctx: DomainContext) {
  const frontier = await getGlobalFrontier(ctx.db, ctx.userId);
  const [profile, capabilities, metaSkills] = await Promise.all([
    getProfile(ctx.db, ctx.userId, { frontierCounts: frontier.counts }),
    listCapabilities(ctx.db, ctx.userId),
    getMetaSkills(ctx.db, ctx.userId, ctx.now),
  ]);

  return { ...profile, frontier, capabilities, meta_skills: metaSkills };
}
