// v1.9 — competencies (higher-order aggregates of KCs across courses) and
// metacognitive learner-skill signals (docs/api.md's "GET /profile/capabilities").
// Both are computed on read (ADR-004): nothing here is stored beyond the
// capabilities/capability_kcs rows themselves (source: seed via
// courses/capabilities.json, or source: 'user' — schema-ready, no UI yet).
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { capabilities, capabilityKcs, events, kcs, tutorConversations, userCorrections } from '../../db/schema';
import { foldCapabilityMastery } from '../capabilityMastery';
import { foldMetaSkills, type MetaSkillSignal } from '../metaSkills';
import type { MetaSkill } from '../schemas/capabilities';
import type { KcStatus } from './mastery';

export type CapabilityMemberRow = {
  kcId: string;
  name: string;
  courseId: string;
  mastery: number;
  status: KcStatus;
  weight: number;
};

export type CapabilityRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  source: 'seed' | 'user';
  mastery: number;
  coverage: number;
  status: KcStatus;
  members: CapabilityMemberRow[];
};

/**
 * Lists the user's competencies with derived mastery/coverage/status
 * (src/lib/capabilityMastery.ts) folded from their current member KCs.
 * A capability with zero members (shouldn't happen post-seed, but not
 * schema-enforced) folds to the empty-members result (0/0/not-started).
 */
export async function listCapabilities(db: Db, userId: string): Promise<CapabilityRow[]> {
  const capabilityRows = await db
    .select()
    .from(capabilities)
    .where(eq(capabilities.userId, userId))
    .orderBy(asc(capabilities.createdAt));
  if (capabilityRows.length === 0) return [];

  const capabilityIds = capabilityRows.map((c) => c.id);
  const memberRows = await db
    .select({
      capabilityId: capabilityKcs.capabilityId,
      weight: capabilityKcs.weight,
      kcId: kcs.id,
      name: kcs.name,
      courseId: kcs.courseId,
      mastery: kcs.mastery,
      status: kcs.status,
    })
    .from(capabilityKcs)
    .innerJoin(kcs, eq(capabilityKcs.kcId, kcs.id))
    .where(inArray(capabilityKcs.capabilityId, capabilityIds));

  const membersByCapability = new Map<string, CapabilityMemberRow[]>();
  for (const row of memberRows) {
    const list = membersByCapability.get(row.capabilityId) ?? [];
    list.push({
      kcId: row.kcId,
      name: row.name,
      courseId: row.courseId,
      mastery: row.mastery,
      status: row.status as KcStatus,
      weight: row.weight,
    });
    membersByCapability.set(row.capabilityId, list);
  }

  return capabilityRows.map((cap) => {
    const members = membersByCapability.get(cap.id) ?? [];
    const fold = foldCapabilityMastery(members);
    return {
      id: cap.id,
      slug: cap.slug,
      name: cap.name,
      description: cap.description,
      source: cap.source,
      mastery: fold.mastery,
      coverage: fold.coverage,
      status: fold.status,
      members,
    };
  });
}

// Event types that count as deliberate retrieval practice (self-testing),
// per docs/api.md's meta-skills definition.
const RETRIEVAL_EVENT_TYPES = ['retrieval_practice', 'quiz_taken', 'self_assessment'] as const;

/** Reads a pass/fail outcome from an assessment event's payload, mirroring
 *  the payload keys services/mastery.ts::eventSuccess reads. `null` means
 *  the payload carries no explicit outcome signal (can't classify). */
function assessmentOutcome(payload: unknown): 'pass' | 'fail' | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (typeof p.correct === 'boolean') return p.correct ? 'pass' : 'fail';
  if (typeof p.correctness === 'number') return p.correctness >= 0.5 ? 'pass' : 'fail';
  if (typeof p.score === 'number') return p.score >= 50 ? 'pass' : 'fail';
  if (typeof p.self_rating === 'number') return p.self_rating >= 3 ? 'pass' : 'fail';
  return null;
}

/**
 * Gathers raw activity signals for the fixed 3-item meta-skill catalog and
 * folds them (src/lib/metaSkills.ts). Definitions (docs/api.md, plan Q re:
 * "Meta-skills"):
 *  - retrieval_practice: events whose type is one of RETRIEVAL_EVENT_TYPES
 *    (deliberate self-testing, as opposed to passive instructional events).
 *  - self_explanation: tutor_conversations in the 'self_explain' mode
 *    (Socratic "why" dialogue), plus 'taught_someone' events (explaining a
 *    concept to someone else is the same generative-explanation skill).
 *  - error_analysis: accepted corrections (user_corrections rows — the
 *    ledger of misconceptions a learner has explicitly reckoned with), plus
 *    "failed-then-later-passed" recoveries: for each KC, walk its assessment
 *    events (isAssessment) in time order; once a 'fail' outcome is seen,
 *    the next later 'pass' outcome on that same KC counts as one
 *    error_analysis signal (the moment of diagnosing and correcting a
 *    mistake), timestamped at the passing attempt. Events with no
 *    classifiable outcome in their payload are skipped, not treated as
 *    fail or pass.
 */
export async function getMetaSkills(db: Db, userId: string, now: number = Date.now()): Promise<MetaSkill[]> {
  const signals: MetaSkillSignal[] = [];

  // Single scan over events covering all three event-sourced signals below
  // (retrieval_practice types, taught_someone, and assessment outcomes for
  // the error_analysis fail->pass walk) instead of three separate table
  // scans — a row can match more than one branch (e.g. a quiz_taken event
  // is both a retrieval-practice type and an assessment outcome).
  const relevantEvents = await db
    .select({ type: events.type, ts: events.ts, kcId: events.kcId, payload: events.payload, isAssessment: events.isAssessment })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        or(inArray(events.type, [...RETRIEVAL_EVENT_TYPES, 'taught_someone']), eq(events.isAssessment, true)),
      ),
    )
    .orderBy(asc(events.ts));

  const byKc = new Map<string, { ts: number; payload: unknown }[]>();
  for (const e of relevantEvents) {
    if ((RETRIEVAL_EVENT_TYPES as readonly string[]).includes(e.type)) {
      signals.push({ key: 'retrieval_practice', ts: e.ts });
    }
    if (e.type === 'taught_someone') {
      signals.push({ key: 'self_explanation', ts: e.ts });
    }
    if (e.isAssessment && e.kcId) {
      const list = byKc.get(e.kcId) ?? [];
      list.push({ ts: e.ts, payload: e.payload });
      byKc.set(e.kcId, list);
    }
  }

  const selfExplainConversations = await db
    .select({ ts: tutorConversations.createdAt })
    .from(tutorConversations)
    .where(and(eq(tutorConversations.userId, userId), eq(tutorConversations.mode, 'self_explain')));
  for (const c of selfExplainConversations) signals.push({ key: 'self_explanation', ts: c.ts });

  const corrections = await db
    .select({ ts: userCorrections.acceptedAt })
    .from(userCorrections)
    .where(eq(userCorrections.userId, userId));
  for (const c of corrections) signals.push({ key: 'error_analysis', ts: c.ts });

  for (const kcEvents of byKc.values()) {
    let sawFailure = false;
    for (const e of kcEvents) {
      const outcome = assessmentOutcome(e.payload);
      if (outcome === 'fail') {
        sawFailure = true;
      } else if (outcome === 'pass' && sawFailure) {
        signals.push({ key: 'error_analysis', ts: e.ts });
        sawFailure = false;
      }
    }
  }

  return foldMetaSkills(signals, now);
}
