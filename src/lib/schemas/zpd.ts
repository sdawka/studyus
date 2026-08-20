// Mirrors services/mastery.ts::KC_STATUSES — see capabilities.ts for the same
// note on why this isn't imported directly from the service layer.
type KcStatus = 'not-started' | 'learning' | 'review' | 'mastered';

// One frontier KC: unmastered, every prerequisite ready (see src/lib/zpd.ts's
// pure selectFrontier — readiness = status !== 'not-started' && mastery >=
// MASTERY_CONSTANTS.REVIEW_THRESHOLD, single definition shared with
// knowledgeMap.ts's isReady).
// Response shape only (never parsed) — plain TS type, not Zod (house rule:
// Zod validates requests; responses are plain TS types, see
// src/lib/types/calendar.ts).
export type FrontierKc = {
  kc_id: string;
  name: string;
  slug: string | null;
  mastery: number;
  status: KcStatus;
};

// Response shape only (never parsed) — plain TS type, not Zod.
export type FrontierByCourse = {
  course_id: string;
  course_title: string;
  course_slug: string;
  color: string | null;
  frontier: FrontierKc[];
};

// GET /profile/frontier response — computed on read from kcs + kc_edges
// (src/lib/services/zpd.ts::getGlobalFrontier), zero persistence.
// Response shape only (never parsed) — plain TS type, not Zod.
export type FrontierResponse = {
  by_course: FrontierByCourse[];
  counts: {
    frontier: number;
    blocked: number;
    mastered: number;
    total: number;
  };
};
