import type { CourseSetupProposal } from '../schemas/onboarding';
import { behavioralEventSchema, type BehavioralEvent } from './events';

export const ONBOARDING_STARTED_COOKIE = 'studyus_onboarding_started';
const ONBOARDING_TOKEN_VERSION = 'v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OnboardingReviewMetrics = {
  renamed: number;
  reordered: number;
  excluded: number;
};

type ReviewItem = { id: string; name: string; order: number; included: boolean };

function reviewItems(proposal: CourseSetupProposal | null): ReviewItem[] {
  if (!proposal) return [];
  return proposal.branches.flatMap((branch) => [
    { id: `branch:${branch.client_id}`, name: branch.name, order: branch.sort_order, included: branch.included },
    ...branch.kcs.map((kc) => ({
      id: `kc:${kc.client_id}`,
      name: kc.name,
      order: kc.sort_order,
      included: branch.included && kc.included,
    })),
  ]);
}

export function summarizeOnboardingReview(
  initial: CourseSetupProposal | null,
  submitted: CourseSetupProposal | null,
): OnboardingReviewMetrics {
  const before = new Map(reviewItems(initial).map((item) => [item.id, item]));
  return reviewItems(submitted).reduce<OnboardingReviewMetrics>((counts, item) => {
    const original = before.get(item.id);
    if (!original) return counts;
    if (item.name !== original.name) counts.renamed += 1;
    if (item.order !== original.order) counts.reordered += 1;
    if (original.included && !item.included) counts.excluded += 1;
    return counts;
  }, { renamed: 0, reordered: 0, excluded: 0 });
}

export function createOnboardingStartedToken(
  startedAt = Date.now(),
  createId: () => string = () => crypto.randomUUID(),
): string {
  return `${ONBOARDING_TOKEN_VERSION}_${startedAt.toString(36)}_${createId()}`;
}

export function readOnboardingStartedAt(token: string | undefined, now = Date.now()): number | undefined {
  const [version, encodedStartedAt, nonce, ...extra] = token?.split('_') ?? [];
  if (version !== ONBOARDING_TOKEN_VERSION || !encodedStartedAt || !nonce || extra.length > 0 || !UUID_PATTERN.test(nonce)) return undefined;
  const startedAt = Number.parseInt(encodedStartedAt, 36);
  if (!Number.isSafeInteger(startedAt) || startedAt <= 0 || startedAt > now) return undefined;
  return startedAt;
}

export function onboardingDurationMs(startedAt: number | undefined, completedAt: number): number {
  if (!startedAt) return 0;
  return Math.min(86_400_000, Math.max(0, completedAt - startedAt));
}

export type OnboardingBehavioralSummary = {
  completed_at: number;
  path: 'template' | 'manual' | 'document';
  template_id?: string;
  course_count: number;
  kc_count: number;
};

export function buildOnboardingBehavioralEvents(input: {
  user_id: string;
  session_id: string;
  trial_session_id?: string;
  draft_id: string;
  started_at?: number;
  review_metrics: OnboardingReviewMetrics;
  summary: OnboardingBehavioralSummary;
}): BehavioralEvent[] {
  const base = {
    user_id: input.user_id,
    session_id: input.session_id,
    surface: '/onboarding',
    ts: input.summary.completed_at,
  };
  const candidates = [
    {
      name: 'onboarding_path_chosen',
      ...base,
      path: input.summary.path,
      import_from_trial: input.trial_session_id === input.draft_id,
    },
    {
      name: 'onboarding_map_reviewed',
      ...base,
      ...input.review_metrics,
      ...(input.summary.template_id ? { template_id: input.summary.template_id } : {}),
    },
    {
      name: 'onboarding_completed_auth',
      ...base,
      course_count: input.summary.course_count,
      kc_count: input.summary.kc_count,
      duration_ms: onboardingDurationMs(input.started_at, input.summary.completed_at),
    },
  ];
  const parsed = candidates.map((candidate) => behavioralEventSchema.safeParse(candidate));
  return parsed.every((result) => result.success)
    ? parsed.flatMap((result) => (result.success ? [result.data] : []))
    : [];
}
