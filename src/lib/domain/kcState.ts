import { eventSuccess, foldMastery, type FoldEvent, type KcStatus } from '../services/mastery';

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIDENCE_RECENCY_HALF_LIFE_MS = 30 * DAY_MS;
const RETENTION_DELAY_MS = DAY_MS;

export type MasteryRule = {
  threshold?: number;
  minimum_evidence?: number;
  requires_transfer?: boolean;
  requires_retention?: boolean;
};

export type KcEvidence = FoldEvent & {
  id: string;
  type?: string;
  experienceId?: string | null;
};

export type KcState = {
  masteryEstimate: number;
  masteryStatus: KcStatus;
  /** A bounded evidence-quality score, not a probability that the learner knows the KC. */
  confidence: number;
  evidenceIds: string[];
  lastUpdatedAt: number | null;
  hasTransferEvidence: boolean;
  hasRetentionEvidence: boolean;
  meetsMasteryRule: boolean;
  lastEvidenceSucceeded: boolean | null;
  lastExperienceId: string | null;
  activeMisconceptionIds: string[];
  evidence: KcEvidence[];
};

function evidenceTags(event: KcEvidence): Set<string> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const values = [payload.evidence_type, payload.evidence_kind, payload.purpose];
  for (const key of ['evidence_tags', 'tags']) {
    if (Array.isArray(payload[key])) values.push(...payload[key]);
  }
  return new Set(values.filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase()));
}

function evidenceSuccess(payload: unknown): boolean | null {
  const value = (payload ?? {}) as Record<string, unknown>;
  if (typeof value.correct === 'boolean') return value.correct;
  if (typeof value.correctness === 'number') return value.correctness >= 0.8;
  if (typeof value.score === 'number') return value.score >= 80;
  if (typeof value.self_rating === 'number') return value.self_rating >= 4;
  if (typeof value.final_rating === 'number') return value.final_rating >= 4;
  return null;
}

function misconceptionIds(events: KcEvidence[]): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const succeeded = evidenceSuccess(payload);
    const candidates = [payload.misconception_id, ...(Array.isArray(payload.misconception_ids) ? payload.misconception_ids : [])];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      if (succeeded === true || payload.misconception_repaired === true) ids.delete(candidate);
      else if (succeeded === false || payload.misconception_detected === true) ids.add(candidate);
    }
  }
  return [...ids].sort();
}

export function deriveKcState(allEvents: KcEvidence[], rule: MasteryRule = {}, now: number = Date.now()): KcState {
  const evidence = allEvents
    .filter((event) => event.isInstructional || event.isAssessment)
    .slice()
    .sort((left, right) => left.ts - right.ts || left.id.localeCompare(right.id));
  const folded = foldMastery(evidence, now);
  const firstAt = evidence[0]?.ts ?? null;
  const threshold = Math.max(0, Math.min(1, rule.threshold ?? 0.8));
  const hasLaterTagged = (tag: string, minimumDelay: number) => firstAt !== null && evidence.some((event) =>
    event.isAssessment && event.ts >= firstAt + minimumDelay && evidenceTags(event).has(tag)
      && eventSuccess(event.payload) >= threshold,
  );
  const hasTransferEvidence = hasLaterTagged('transfer', 1);
  const hasRetentionEvidence = hasLaterTagged('retention', RETENTION_DELAY_MS);

  const countScore = Math.min(1, evidence.length / 5);
  const diversityScore = Math.min(1, new Set(evidence.map((event) => event.type ?? 'unknown')).size / 3);
  const recencyScore = folded.lastEventAt === null ? 0 : Math.pow(0.5, Math.max(0, now - folded.lastEventAt) / CONFIDENCE_RECENCY_HALF_LIFE_MS);
  const confidence = Math.round(((countScore + diversityScore + recencyScore) / 3) * 100) / 100;
  const latest = evidence.at(-1);
  const enoughEvidence = evidence.length >= (rule.minimum_evidence ?? 1);
  const meetsMasteryRule = folded.mastery / 100 >= threshold && enoughEvidence
    && (!rule.requires_transfer || hasTransferEvidence)
    && (!rule.requires_retention || hasRetentionEvidence);

  return {
    masteryEstimate: folded.mastery,
    masteryStatus: folded.status,
    confidence,
    evidenceIds: evidence.map((event) => event.id),
    lastUpdatedAt: folded.lastEventAt,
    hasTransferEvidence,
    hasRetentionEvidence,
    meetsMasteryRule,
    lastEvidenceSucceeded: latest ? evidenceSuccess(latest.payload) : null,
    lastExperienceId: latest?.experienceId ?? null,
    activeMisconceptionIds: misconceptionIds(evidence),
    evidence,
  };
}
