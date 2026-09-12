// Pure mastery fold: (events for a KC, now) -> { mastery, status }.
//
// DataShop-flavored recipe (documented per the plan's mandate):
//   1. Assessment-role (AE) events each contribute a "success" value in
//      [0,1], read from their payload (see `eventSuccess`). These are
//      averaged with a recency weight (half-life RECENCY_HALF_LIFE_MS) so
//      recent attempts count more than old ones — approximating "recency-
//      weighted first-attempt success rate" without modeling attempt-order
//      per KC explicitly (each event already *is* one opportunity).
//   2. Instructional-role (IE) events contribute a small additive exposure
//      bump (IE_BUMP_POINTS each, recency-weighted, capped at IE_BUMP_CAP) —
//      "I was exposed to this" nudges mastery up a little even with no
//      assessment evidence yet, but can never alone reach "mastered".
//   3. Idle decay: the combined raw score is pulled toward FLOOR_RATIO of
//      itself with half-life IDLE_DECAY_HALF_LIFE_MS since the last event —
//      a long-idle KC drifts down (typically out of "mastered" into
//      "review") without ever crashing all the way to zero, since retained
//      knowledge doesn't vanish just because it hasn't been exercised.
//   4. Status is a plain threshold read of the decayed mastery number, with
//      "not-started" reserved for KCs with zero events.
//
// Recomputation is just re-folding: because this function is pure and takes
// the full event list, "edit an event" and "delete an event" both reduce to
// "re-run this fold over what remains."
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Db } from '../../db/client';
import {
  courses,
  branches,
  events,
  experienceKcs,
  experienceMisconceptions,
  experiences,
  exercises,
  kcEdges,
  kcs,
  scaffolds,
} from '../../db/schema';
import { deriveKcState } from '../domain/kcState';
import { selectNextExperience } from '../domain/nextExperience';
import { requireOwnedKc } from './util';

const DAY_MS = 24 * 60 * 60 * 1000;

export const MASTERY_CONSTANTS = {
  RECENCY_HALF_LIFE_MS: 30 * DAY_MS,
  IE_BUMP_POINTS: 4,
  IE_BUMP_CAP: 15,
  IDLE_DECAY_HALF_LIFE_MS: 30 * DAY_MS,
  IDLE_DECAY_FLOOR_RATIO: 0.5,
  DEFAULT_AE_SUCCESS: 0.7,
  MASTERED_THRESHOLD: 80,
  REVIEW_THRESHOLD: 40,
} as const;

export const KC_STATUSES = ['not-started', 'learning', 'review', 'mastered'] as const;
export type KcStatus = (typeof KC_STATUSES)[number];

export type FoldEvent = {
  ts: number;
  isInstructional: boolean;
  isAssessment: boolean;
  payload?: unknown;
};

export type MasteryResult = {
  mastery: number;
  status: KcStatus;
  lastEventAt: number | null;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function recencyWeight(ts: number, now: number, halfLifeMs: number): number {
  const ageMs = Math.max(0, now - ts);
  return Math.pow(0.5, ageMs / halfLifeMs);
}

/** Reads a [0,1] success signal from an AE event's payload. Falls back to a
 *  neutral default when the payload carries no explicit outcome (e.g. a
 *  bare `quiz_taken` with no score attached yet). `correctness` has no
 *  emitter yet — reserved for graders that produce a continuous [0,1]. */
export function eventSuccess(payload: unknown): number {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (typeof p.correct === 'boolean') return p.correct ? 1 : 0;
  if (typeof p.correctness === 'number') return clamp01(p.correctness);
  if (typeof p.score === 'number') return clamp01(p.score / 100);
  if (typeof p.self_rating === 'number') return clamp01(p.self_rating / 5);
  // Tutor sessions record the learner's closing 1-5 rating as `final_rating`.
  if (typeof p.final_rating === 'number') return clamp01(p.final_rating / 5);
  return MASTERY_CONSTANTS.DEFAULT_AE_SUCCESS;
}

function statusFor(mastery: number, hasEvents: boolean): KcStatus {
  if (!hasEvents) return 'not-started';
  if (mastery >= MASTERY_CONSTANTS.MASTERED_THRESHOLD) return 'mastered';
  if (mastery >= MASTERY_CONSTANTS.REVIEW_THRESHOLD) return 'review';
  return 'learning';
}

export function foldMastery(events: FoldEvent[], now: number = Date.now()): MasteryResult {
  // The domain stream also holds a small number of durable context facts. Only
  // learning evidence may establish freshness or contribute to mastery; product
  // usage belongs in the separate behavioral stream.
  const evidenceEvents = events.filter((event) => event.isInstructional || event.isAssessment);

  if (evidenceEvents.length === 0) {
    return { mastery: 0, status: 'not-started', lastEventAt: null };
  }

  const { RECENCY_HALF_LIFE_MS, IE_BUMP_POINTS, IE_BUMP_CAP, IDLE_DECAY_HALF_LIFE_MS, IDLE_DECAY_FLOOR_RATIO } =
    MASTERY_CONSTANTS;

  let weightedSuccessSum = 0;
  let weightSum = 0;
  let ieBump = 0;

  for (const e of evidenceEvents) {
    if (e.isAssessment) {
      const w = recencyWeight(e.ts, now, RECENCY_HALF_LIFE_MS);
      weightedSuccessSum += w * eventSuccess(e.payload);
      weightSum += w;
    }
    if (e.isInstructional) {
      ieBump += IE_BUMP_POINTS * recencyWeight(e.ts, now, RECENCY_HALF_LIFE_MS);
    }
  }
  ieBump = Math.min(ieBump, IE_BUMP_CAP);

  const aeComponent = weightSum > 0 ? (weightedSuccessSum / weightSum) * 100 : 0;
  const raw = Math.min(100, aeComponent + ieBump);

  const lastEventAt = Math.max(...evidenceEvents.map((e) => e.ts));
  const idleMs = Math.max(0, now - lastEventAt);
  const decayFactor = Math.pow(0.5, idleMs / IDLE_DECAY_HALF_LIFE_MS);
  const decayed = raw * decayFactor + raw * IDLE_DECAY_FLOOR_RATIO * (1 - decayFactor);

  const mastery = Math.round(Math.max(0, Math.min(100, decayed)));
  return { mastery, status: statusFor(mastery, true), lastEventAt };
}

/** Standalone (non-batched) recompute: query all events for a KC, fold, and
 *  write the derived cache back. Used for one-off recomputes (e.g. backfill,
 *  or ownership already established by the caller); the events service uses
 *  the pure `foldMastery` directly inside its own db.batch instead, since it
 *  needs the write to be atomic with the event insert/update/delete. */
export async function recomputeKcMastery(db: Db, kcId: string, now: number = Date.now()): Promise<MasteryResult> {
  const linked = await db.select({ experienceId: experienceKcs.experienceId })
    .from(experienceKcs)
    .where(and(eq(experienceKcs.kcId, kcId), eq(experienceKcs.isEvidenceTarget, true)));
  const target = linked.length > 0
    ? or(eq(events.kcId, kcId), inArray(events.experienceId, linked.map((row) => row.experienceId)))!
    : eq(events.kcId, kcId);
  const rows = await db
    .select({ ts: events.ts, isInstructional: events.isInstructional, isAssessment: events.isAssessment, payload: events.payload })
    .from(events)
    .where(target);

  const result = foldMastery(rows, now);
  await db
    .update(kcs)
    .set({ mastery: result.mastery, status: result.status, lastEventAt: result.lastEventAt })
    .where(eq(kcs.id, kcId));
  return result;
}

/** Recomputes the auditable learner-owned KC read model from the event stream. */
export async function getKcState(db: Db, userId: string, kcId: string, now: number = Date.now()) {
  const kc = await requireOwnedKc(db, userId, kcId);
  const linked = await db.select({ experienceId: experienceKcs.experienceId })
    .from(experienceKcs)
    .where(and(eq(experienceKcs.kcId, kcId), eq(experienceKcs.isEvidenceTarget, true)));
  const target = linked.length > 0
    ? or(eq(events.kcId, kcId), inArray(events.experienceId, linked.map((row) => row.experienceId)))!
    : eq(events.kcId, kcId);
  const rows = await db.select({
    id: events.id,
    ts: events.ts,
    type: events.type,
    isInstructional: events.isInstructional,
    isAssessment: events.isAssessment,
    experienceId: events.experienceId,
    payload: events.payload,
  }).from(events).where(and(eq(events.userId, userId), target));
  return deriveKcState(rows, kc.masteryRule, now);
}

function selectionTags(content: unknown): string[] {
  if (!content || typeof content !== 'object') return [];
  const value = content as Record<string, unknown>;
  const policy = value.selection_policy && typeof value.selection_policy === 'object'
    ? value.selection_policy as Record<string, unknown> : {};
  const candidates = [value.evidence_type, value.evidence_kind, value.purpose];
  if (Array.isArray(policy.evidence_tags)) candidates.push(...policy.evidence_tags);
  for (const key of ['evidence_tags', 'tags']) {
    if (Array.isArray(value[key])) candidates.push(...value[key]);
  }
  return candidates.filter((candidate): candidate is string => typeof candidate === 'string');
}

/** Owner-scoped query boundary: assemble data, invoke the pure policy, then resolve its row. */
export async function getNextExperience(db: Db, userId: string, now: number = Date.now()) {
  const kcRows = await db.select({ kc: kcs }).from(kcs)
    .innerJoin(branches, eq(kcs.branchId, branches.id))
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(
      eq(courses.userId, userId),
      eq(courses.archived, false),
      isNull(branches.archivedAt),
      isNull(kcs.archivedAt),
    ))
    .then((rows) => rows.map((row) => row.kc));
  const kcIds = kcRows.map((kc) => kc.id);
  const experienceRows = await db.select({ experience: experiences }).from(experiences)
    .innerJoin(courses, eq(experiences.courseId, courses.id))
    .where(and(eq(courses.userId, userId), eq(courses.archived, false)))
    .then((rows) => rows.map((row) => row.experience));
  const experienceIds = experienceRows.map((experience) => experience.id);
  if (kcIds.length === 0 || experienceIds.length === 0) throw new Error('No eligible learner-owned experience');

  const [edges, links, diagnostics, scaffoldRows, exerciseRows, stateEntries] = await Promise.all([
    db.select({ kcId: kcEdges.kcId, prerequisiteKcId: kcEdges.prereqKcId }).from(kcEdges)
      .where(and(inArray(kcEdges.kcId, kcIds), inArray(kcEdges.prereqKcId, kcIds))),
    db.select({ experienceId: experienceKcs.experienceId, kcId: experienceKcs.kcId, isEvidenceTarget: experienceKcs.isEvidenceTarget, sortOrder: experienceKcs.sortOrder }).from(experienceKcs)
      .where(and(
        inArray(experienceKcs.experienceId, experienceIds),
        inArray(experienceKcs.kcId, kcIds),
      )),
    db.select({ experienceId: experienceMisconceptions.experienceId, misconceptionId: experienceMisconceptions.misconceptionId })
      .from(experienceMisconceptions).where(inArray(experienceMisconceptions.experienceId, experienceIds)),
    db.select({ experienceId: scaffolds.experienceId, level: scaffolds.level }).from(scaffolds)
      .where(inArray(scaffolds.experienceId, experienceIds)),
    db.select({ experienceId: exercises.experienceId, difficulty: exercises.difficulty }).from(exercises)
      .where(inArray(exercises.experienceId, experienceIds)),
    Promise.all(kcIds.map(async (kcId) => [kcId, await getKcState(db, userId, kcId, now)] as const)),
  ]);
  const support = new Map<string, number>();
  for (const row of scaffoldRows) if (row.experienceId) support.set(row.experienceId, row.level);
  for (const row of exerciseRows) if (row.experienceId) support.set(row.experienceId, row.difficulty);
  const states = Object.fromEntries(stateEntries);
  const selection = selectNextExperience({
    learnerId: userId,
    kcs: kcRows.map((kc) => ({
      id: kc.id,
      learnerId: userId,
      prerequisiteKcIds: edges.filter((edge) => edge.kcId === kc.id).map((edge) => edge.prerequisiteKcId),
      masteryRule: kc.masteryRule,
      kcForm: kc.kcForm,
    })),
    experiences: experienceRows.map((experience) => ({
      id: experience.id,
      learnerId: userId,
      targetKcIds: links.filter((link) => link.experienceId === experience.id)
        .sort((left, right) => left.sortOrder - right.sortOrder).map((link) => link.kcId),
      kind: experience.kind,
      supportLevel: support.get(experience.id),
      evidenceTags: selectionTags(experience.content),
      diagnosticMisconceptionIds: diagnostics.filter((row) => row.experienceId === experience.id).map((row) => row.misconceptionId),
      intendedProcesses: experience.intendedProcesses,
      sortOrder: experience.sortOrder,
    })).filter((experience) => experience.targetKcIds.length > 0),
  }, states, now);
  const experience = experienceRows.find((row) => row.id === selection.experienceId);
  if (!experience) throw new Error('Selected experience is no longer learner-owned');
  return { experience, reasons: selection.reasons };
}
