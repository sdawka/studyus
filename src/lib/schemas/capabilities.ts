// Mirrors services/mastery.ts::KC_STATUSES — not imported directly to keep
// the schemas layer free of a service-layer dependency; kept in sync by
// convention (same as other status/enum duplication in this codebase).
type KcStatus = 'not-started' | 'learning' | 'review' | 'mastered';

// One competency member: a KC folded into a capability's derived mastery,
// with the weight it was authored with (capability_kcs.weight).
// Response shape only (never parsed) — plain TS type, not Zod (house rule:
// Zod validates requests; responses are plain TS types, see
// src/lib/types/calendar.ts).
export type CapabilityMember = {
  kc_id: string;
  name: string;
  course_id: string;
  mastery: number;
  status: KcStatus;
  weight: number;
};

// GET /profile/capabilities row shape — mastery/coverage/status are derived
// on read (src/lib/capabilityMastery.ts), never stored. `status` uses the
// same MASTERY_CONSTANTS thresholds as KCs, but 'mastered' additionally
// requires coverage === 1 (no "mastered" off a fraction of members).
// Response shape only (never parsed) — plain TS type, not Zod.
export type CapabilityResponse = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  source: 'seed' | 'user';
  mastery: number;
  coverage: number;
  status: KcStatus;
  members: CapabilityMember[];
};

// Fixed catalog of 3 metacognitive learner skills — derived, never stored.
// Deliberately frequency/trend, not a 0-100 score (KLI honesty +
// anti-gamification, vision.md). See src/lib/metaSkills.ts.
export const META_SKILL_KEYS = ['retrieval_practice', 'self_explanation', 'error_analysis'] as const;
export type MetaSkillKey = (typeof META_SKILL_KEYS)[number];

// Response shape only (never parsed) — plain TS type, not Zod.
export type MetaSkill = {
  key: MetaSkillKey;
  count_28d: number;
  count_prior_28d: number;
  trend: 'up' | 'flat' | 'down';
  last_at: string | null;
};
