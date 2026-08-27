import type {
  AvailableMinutes,
  NextMove,
  NextMoveKind,
  NextMoveMethod,
  NextMoveReason,
  NextMoveResponse,
} from './schemas/nextMove';
import { isReady } from './services/knowledgeMap';

const DAY_MS = 24 * 60 * 60 * 1000;
export const NEXT_MOVE_ASSESSMENT_HORIZON_DAYS = 30;
export const NEXT_MOVE_STALE_DAYS = 7;

export type NextMoveKcInput = {
  id: string;
  name: string;
  kcType: string;
  mastery: number;
  status: string;
  lastEventAt: number | null;
  prereqIds: string[];
  activeMcqCount: number;
  courseId: string;
  courseSlug: string;
  courseCode: string;
  courseTitle: string;
  courseColor: string | null;
  branchSortOrder: number;
  kcSortOrder: number;
};

export type NextMoveAssessmentInput = {
  id: string;
  title: string;
  dueAt: number;
  weightPct: number | null;
  kcIds: string[];
};

type AssessmentContext = NextMoveAssessmentInput & { targetKcIds: Set<string> };
type Candidate = {
  kc: NextMoveKcInput;
  assessments: Map<string, AssessmentContext>;
  repairedTargets: Map<string, string>;
  score: number;
};

export function questionCountForMinutes(minutes: AvailableMinutes): number {
  if (minutes === 15) return 3;
  if (minutes === 25) return 5;
  return 8;
}

function isKcReady(kc: NextMoveKcInput | undefined): boolean {
  return Boolean(kc && isReady(kc.status, kc.mastery));
}

function prereqsReady(kc: NextMoveKcInput, byId: Map<string, NextMoveKcInput>): boolean {
  return kc.prereqIds.every((id) => isKcReady(byId.get(id)));
}

/**
 * Finds the unready prerequisite nodes that are themselves actionable now.
 * A blocked target may be several edges away from its first useful repair;
 * the visited set is a defensive stop for malformed legacy cycles.
 */
function actionableBlockers(
  target: NextMoveKcInput,
  byId: Map<string, NextMoveKcInput>,
  visited: Set<string> = new Set(),
): NextMoveKcInput[] {
  if (visited.has(target.id)) return [];
  visited.add(target.id);

  const out = new Map<string, NextMoveKcInput>();
  for (const prereqId of target.prereqIds) {
    const prereq = byId.get(prereqId);
    if (!prereq || isKcReady(prereq)) continue;
    if (prereqsReady(prereq, byId)) out.set(prereq.id, prereq);
    else for (const blocker of actionableBlockers(prereq, byId, new Set(visited))) out.set(blocker.id, blocker);
  }
  return [...out.values()];
}

function strongestAssessment(candidate: Candidate): AssessmentContext | null {
  return [...candidate.assessments.values()].sort(
    (a, b) => a.dueAt - b.dueAt || (b.weightPct ?? -1) - (a.weightPct ?? -1) || a.id.localeCompare(b.id),
  )[0] ?? null;
}

function scoreCandidate(candidate: Candidate, now: number): number {
  const assessment = strongestAssessment(candidate);
  const daysUntil = assessment ? Math.max(0, (assessment.dueAt - now) / DAY_MS) : NEXT_MOVE_ASSESSMENT_HORIZON_DAYS;
  const assessmentUrgency = assessment ? Math.max(0, 1 - daysUntil / NEXT_MOVE_ASSESSMENT_HORIZON_DAYS) : 0;
  const masteryNeed = 1 - Math.max(0, Math.min(100, candidate.kc.mastery)) / 100;
  const idleDays = candidate.kc.lastEventAt === null ? 0 : Math.max(0, (now - candidate.kc.lastEventAt) / DAY_MS);
  const recency = Math.min(idleDays / 30, 1);
  const leverage = Math.min(candidate.repairedTargets.size / 3, 1);
  return 0.4 * assessmentUrgency + 0.3 * masteryNeed + 0.2 * recency + 0.1 * leverage;
}

function kindFor(candidate: Candidate, now: number): NextMoveKind {
  if (candidate.repairedTargets.size > 0) return 'prerequisite_repair';
  if (candidate.assessments.size > 0) return 'assessment_practice';
  if (candidate.kc.lastEventAt !== null && now - candidate.kc.lastEventAt >= NEXT_MOVE_STALE_DAYS * DAY_MS) return 'stale_review';
  return 'frontier_understand';
}

function methodFor(candidate: Candidate, minutes: AvailableMinutes): NextMoveMethod {
  const count = questionCountForMinutes(minutes);
  return candidate.kc.mastery >= 40 && candidate.kc.activeMcqCount >= count ? 'quick_quiz' : 'understand';
}

function dueReason(assessment: AssessmentContext, now: number): NextMoveReason {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const dueDay = new Date(assessment.dueAt);
  dueDay.setUTCHours(0, 0, 0, 0);
  const days = Math.max(0, Math.round((dueDay.getTime() - today.getTime()) / DAY_MS));
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  const weight = assessment.weightPct === null ? '' : ` · ${assessment.weightPct}% of the course`;
  return { code: 'assessment_urgency', label: `${assessment.title} is due ${when}${weight}` };
}

function reasonsFor(candidate: Candidate, kind: NextMoveKind, minutes: AvailableMinutes, now: number): NextMoveReason[] {
  const reasons: NextMoveReason[] = [];
  const assessment = strongestAssessment(candidate);
  if (assessment) reasons.push(dueReason(assessment, now));

  if (kind === 'prerequisite_repair') {
    const targetName = [...candidate.repairedTargets.values()].sort()[0];
    reasons.push({ code: 'prerequisite_repair', label: `Build this first to unlock ${targetName}` });
  } else {
    reasons.push({ code: 'prerequisite_ready', label: 'Its prerequisites are ready' });
  }

  if (candidate.kc.lastEventAt === null) {
    reasons.push({ code: 'new_concept', label: 'You have not practised this concept yet' });
  } else {
    reasons.push({ code: 'mastery_need', label: `Current mastery is ${candidate.kc.mastery}%` });
    const idleDays = Math.floor((now - candidate.kc.lastEventAt) / DAY_MS);
    if (idleDays >= NEXT_MOVE_STALE_DAYS) reasons.push({ code: 'stale_evidence', label: `Last practised ${idleDays} days ago` });
  }
  const timeFit: NextMoveReason = { code: 'time_fit', label: `Shaped for the ${minutes} minutes you have` };
  return [...reasons.slice(0, 3), timeFit];
}

function toMove(candidate: Candidate, minutes: AvailableMinutes, now: number): NextMove {
  const assessment = strongestAssessment(candidate);
  const kind = kindFor(candidate, now);
  const method = methodFor(candidate, minutes);
  const count = method === 'quick_quiz' ? questionCountForMinutes(minutes) : null;
  const params = new URLSearchParams();
  let actionHref: string;
  if (method === 'quick_quiz') {
    params.set('kc', candidate.kc.id);
    params.set('course', candidate.kc.courseId);
    params.set('minutes', String(minutes));
    params.set('autostart', '1');
    actionHref = `/study/quiz?${params.toString()}`;
  } else {
    params.set('minutes', String(minutes));
    actionHref = `/learn/${candidate.kc.id}?${params.toString()}`;
  }

  return {
    action_id: `${method}:${candidate.kc.id}:${assessment?.id ?? 'none'}:${minutes}`,
    kind,
    method,
    title: candidate.kc.name,
    course: {
      course_id: candidate.kc.courseId,
      course_slug: candidate.kc.courseSlug,
      course_code: candidate.kc.courseCode,
      course_title: candidate.kc.courseTitle,
      color: candidate.kc.courseColor,
    },
    kc: { kc_id: candidate.kc.id, name: candidate.kc.name, mastery: candidate.kc.mastery, status: candidate.kc.status },
    assessment: assessment
      ? { assessment_id: assessment.id, title: assessment.title, due_at: new Date(assessment.dueAt).toISOString(), weight_pct: assessment.weightPct }
      : null,
    planned_minutes: minutes,
    question_count: count,
    action_href: actionHref,
    reasons: reasonsFor(candidate, kind, minutes, now),
  };
}

export function rankNextMoves(
  kcs: NextMoveKcInput[],
  assessments: NextMoveAssessmentInput[],
  availableMinutes: AvailableMinutes,
  now: number = Date.now(),
): NextMoveResponse {
  const byId = new Map(kcs.map((kc) => [kc.id, kc]));
  const candidates = new Map<string, Candidate>();
  const ensureCandidate = (kc: NextMoveKcInput): Candidate => {
    const existing = candidates.get(kc.id);
    if (existing) return existing;
    const candidate: Candidate = { kc, assessments: new Map(), repairedTargets: new Map(), score: 0 };
    candidates.set(kc.id, candidate);
    return candidate;
  };

  const horizonEnd = now + NEXT_MOVE_ASSESSMENT_HORIZON_DAYS * DAY_MS;
  for (const assessment of assessments) {
    if (assessment.dueAt < now || assessment.dueAt > horizonEnd) continue;
    for (const targetId of assessment.kcIds) {
      const target = byId.get(targetId);
      if (!target) continue;
      const blockers = actionableBlockers(target, byId);
      // Never recommend a downstream target while its prerequisites are
      // blocked. A malformed legacy cycle can produce no actionable blocker;
      // skipping it is safer than presenting an impossible action.
      const selected = blockers.length > 0 ? blockers : prereqsReady(target, byId) ? [target] : [];
      for (const kc of selected) {
        const candidate = ensureCandidate(kc);
        const context = candidate.assessments.get(assessment.id) ?? { ...assessment, targetKcIds: new Set<string>() };
        context.targetKcIds.add(target.id);
        candidate.assessments.set(assessment.id, context);
        if (kc.id !== target.id) candidate.repairedTargets.set(target.id, target.name);
      }
    }
  }

  // Generic forward/review candidates come only from the actual frontier.
  // Assessment-linked mastered KCs may still be candidates above for an
  // imminent retrieval check, but mastered KCs never enter this pool.
  for (const kc of kcs) {
    if (kc.status !== 'mastered' && prereqsReady(kc, byId)) ensureCandidate(kc);
  }

  for (const candidate of candidates.values()) candidate.score = scoreCandidate(candidate, now);
  const ordered = [...candidates.values()].sort((a, b) => {
    const aAssessment = strongestAssessment(a);
    const bAssessment = strongestAssessment(b);
    return (
      b.score - a.score ||
      (aAssessment?.dueAt ?? Infinity) - (bAssessment?.dueAt ?? Infinity) ||
      (bAssessment?.weightPct ?? -1) - (aAssessment?.weightPct ?? -1) ||
      a.kc.mastery - b.kc.mastery ||
      (a.kc.lastEventAt ?? 0) - (b.kc.lastEventAt ?? 0) ||
      a.kc.courseCode.localeCompare(b.kc.courseCode) ||
      a.kc.branchSortOrder - b.kc.branchSortOrder ||
      a.kc.kcSortOrder - b.kc.kcSortOrder ||
      a.kc.id.localeCompare(b.kc.id)
    );
  });

  const moves = ordered.slice(0, 3).map((candidate) => toMove(candidate, availableMinutes, now));
  return {
    generated_at: new Date(now).toISOString(),
    available_minutes: availableMinutes,
    recommendation: moves[0] ?? null,
    alternatives: moves.slice(1),
  };
}
