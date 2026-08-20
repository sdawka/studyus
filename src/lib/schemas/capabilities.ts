import { z } from 'zod';
import { idSchema } from './common';

// Mirrors services/mastery.ts::KC_STATUSES — not imported directly to keep
// the schemas layer free of a service-layer dependency; kept in sync by
// convention (same as other status/enum duplication in this codebase).
const kcStatusSchema = z.enum(['not-started', 'learning', 'review', 'mastered']);

// One competency member: a KC folded into a capability's derived mastery,
// with the weight it was authored with (capability_kcs.weight).
export const capabilityMemberSchema = z.object({
  kc_id: idSchema,
  name: z.string(),
  course_id: idSchema,
  mastery: z.number().int().min(0).max(100),
  status: kcStatusSchema,
  weight: z.number().int().positive(),
});
export type CapabilityMember = z.infer<typeof capabilityMemberSchema>;

// GET /profile/capabilities row shape — mastery/coverage/status are derived
// on read (src/lib/capabilityMastery.ts), never stored. `status` uses the
// same MASTERY_CONSTANTS thresholds as KCs, but 'mastered' additionally
// requires coverage === 1 (no "mastered" off a fraction of members).
export const capabilityResponseSchema = z.object({
  id: idSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  source: z.enum(['seed', 'user']),
  mastery: z.number().int().min(0).max(100),
  coverage: z.number().min(0).max(1),
  status: kcStatusSchema,
  members: z.array(capabilityMemberSchema),
});
export type CapabilityResponse = z.infer<typeof capabilityResponseSchema>;

// Fixed catalog of 3 metacognitive learner skills — derived, never stored.
// Deliberately frequency/trend, not a 0-100 score (KLI honesty +
// anti-gamification, vision.md). See src/lib/metaSkills.ts.
export const META_SKILL_KEYS = ['retrieval_practice', 'self_explanation', 'error_analysis'] as const;
export type MetaSkillKey = (typeof META_SKILL_KEYS)[number];

export const metaSkillSchema = z.object({
  key: z.enum(META_SKILL_KEYS),
  count_28d: z.number().int().nonnegative(),
  count_prior_28d: z.number().int().nonnegative(),
  trend: z.enum(['up', 'flat', 'down']),
  last_at: z.string().nullable(),
});
export type MetaSkill = z.infer<typeof metaSkillSchema>;
