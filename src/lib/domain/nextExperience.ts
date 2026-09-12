import type { KcState, MasteryRule } from './kcState';

const SPACING_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type NextExperienceKc = {
  id: string;
  learnerId: string;
  prerequisiteKcIds: string[];
  masteryRule: MasteryRule;
  kcForm?: 'constant_constant' | 'variable_constant' | 'variable_variable' | null;
};

export type NextExperienceCandidate = {
  id: string;
  learnerId: string;
  targetKcIds: string[];
  kind: 'scaffold' | 'exercise' | 'project';
  supportLevel?: number;
  evidenceTags?: string[];
  diagnosticMisconceptionIds?: string[];
  intendedProcesses?: string[];
  sortOrder?: number;
};

export type NextExperienceGraph = {
  learnerId: string;
  kcs: NextExperienceKc[];
  experiences: NextExperienceCandidate[];
};

export type NextExperienceSelection = { experienceId: string; reasons: string[] };

type ScoredCandidate = { candidate: NextExperienceCandidate; score: number; reasons: string[] };

function stateFor(states: Readonly<Record<string, KcState>>, kcId: string): KcState | undefined {
  return states[kcId];
}

function prerequisitesMet(kc: NextExperienceKc, states: Readonly<Record<string, KcState>>): boolean {
  return kc.prerequisiteKcIds.every((id) => stateFor(states, id)?.meetsMasteryRule === true);
}

function isRecent(state: KcState | undefined, now: number): boolean {
  return state?.lastUpdatedAt !== null && state?.lastUpdatedAt !== undefined && now - state.lastUpdatedAt < SPACING_INTERVAL_MS;
}

/** Pure deterministic policy. Database ownership and row assembly stay outside this function. */
export function selectNextExperience(
  graph: NextExperienceGraph,
  states: Readonly<Record<string, KcState>>,
  now: number = Date.now(),
): NextExperienceSelection {
  const kcs = new Map(graph.kcs.map((kc) => [kc.id, kc]));
  for (const kc of graph.kcs) {
    if (kc.learnerId !== graph.learnerId) throw new Error('Cross-learner KC target');
    for (const prerequisiteId of kc.prerequisiteKcIds) {
      const prerequisite = kcs.get(prerequisiteId);
      if (!prerequisite || prerequisite.learnerId !== graph.learnerId) throw new Error('Cross-learner prerequisite target');
    }
  }
  for (const experience of graph.experiences) {
    if (experience.learnerId !== graph.learnerId) throw new Error('Cross-learner experience target');
    if (experience.targetKcIds.length === 0 || experience.targetKcIds.some((id) => !kcs.has(id))) throw new Error('Cross-learner experience target');
  }

  const blocked = graph.kcs.filter((kc) => !prerequisitesMet(kc, states));
  const recentlyRepeatedExists = graph.experiences.some((experience) => experience.targetKcIds.some((id) => {
    const state = stateFor(states, id);
    return state?.lastExperienceId === experience.id && isRecent(state, now);
  }));

  const scored: ScoredCandidate[] = [];
  for (const candidate of graph.experiences) {
    const targets = candidate.targetKcIds.map((id) => kcs.get(id)!);
    if (targets.some((kc) => !prerequisitesMet(kc, states))) continue;

    let score = 100;
    const reasons: string[] = [];
    let hasExplicitReason = false;
    const unmet = targets.find((kc) => !stateFor(states, kc.id)?.meetsMasteryRule);
    if (unmet) reasons.push(`ready unmet KC ${unmet.id}`);
    const preferredProcess = unmet?.kcForm === 'constant_constant' ? 'memory_fluency'
      : unmet?.kcForm === 'variable_constant' ? 'induction_refinement'
        : unmet?.kcForm === 'variable_variable' ? 'understanding_sensemaking' : null;
    if (preferredProcess && candidate.intendedProcesses?.includes(preferredProcess)) score += 50;

    const repairFor = blocked.find((kc) => kc.prerequisiteKcIds.some((id) => candidate.targetKcIds.includes(id)));
    if (repairFor) {
      hasExplicitReason = true;
      score += 400;
      reasons.length = 0;
      reasons.push(`prerequisite repair for ${repairFor.id}`);
    }

    const misconception = targets.flatMap((kc) => stateFor(states, kc.id)?.activeMisconceptionIds ?? [])
      .find((id) => candidate.diagnosticMisconceptionIds?.includes(id));
    if (misconception) {
      hasExplicitReason = true;
      score += 700;
      reasons.length = 0;
      reasons.push(`repairs misconception ${misconception}`);
    }

    const weak = targets.find((kc) => {
      const state = stateFor(states, kc.id);
      return Boolean(state?.evidenceIds.length) && state?.lastEvidenceSucceeded === false;
    });
    if (weak && candidate.kind === 'scaffold' && candidate.supportLevel === 1) {
      hasExplicitReason = true;
      score += 650;
      reasons.length = 0;
      reasons.push(`adds support after weak evidence for ${weak.id}`);
    }

    const tags = new Set((candidate.evidenceTags ?? []).map((tag) => tag.toLowerCase()));
    const due = targets.find((kc) => {
      const state = stateFor(states, kc.id);
      return (tags.has('spacing') || (tags.has('retention') && !state?.hasRetentionEvidence)) && Boolean(state?.evidenceIds.length)
        && state?.lastUpdatedAt !== null && state?.lastUpdatedAt !== undefined && now - state.lastUpdatedAt >= SPACING_INTERVAL_MS;
    });
    if (due) {
      hasExplicitReason = true;
      score += 600;
      reasons.length = 0;
      reasons.push(`spaced review due for ${due.id}`);
    }

    const transfer = targets.find((kc) => {
      const state = stateFor(states, kc.id);
      const threshold = kc.masteryRule.threshold ?? 0.8;
      return tags.has('transfer') && kc.masteryRule.requires_transfer === true && Boolean(state?.evidenceIds.length)
        && !state?.hasTransferEvidence && (state?.masteryEstimate ?? 0) / 100 >= threshold && !isRecent(state, now);
    });
    if (transfer) {
      hasExplicitReason = true;
      score += 550;
      reasons.length = 0;
      reasons.push(`transfer evidence required for ${transfer.id}`);
    } else if (tags.has('transfer') && targets.every((kc) => !stateFor(states, kc.id)?.evidenceIds.length)) {
      score -= 200;
    }

    const faded = targets.find((kc) => {
      const state = stateFor(states, kc.id);
      if (!state?.lastEvidenceSucceeded || !state.lastExperienceId || candidate.supportLevel === undefined) return false;
      const previous = graph.experiences.find((experience) => experience.id === state.lastExperienceId);
      return previous?.supportLevel !== undefined && candidate.supportLevel > previous.supportLevel;
    });
    if (faded) {
      hasExplicitReason = true;
      score += 450;
      reasons.length = 0;
      reasons.push(`fades support after success on ${faded.id}`);
    }

    const immediateRepeat = targets.some((kc) => {
      const state = stateFor(states, kc.id);
      return state?.lastExperienceId === candidate.id && isRecent(state, now);
    });
    if (immediateRepeat) score -= 1_000;
    else if (recentlyRepeatedExists && reasons[0]?.startsWith('ready unmet KC')) reasons.push('avoids immediate repetition');

    if (!unmet && !hasExplicitReason) continue;
    if (reasons.length === 0 && unmet) reasons.push(`ready unmet KC ${unmet.id}`);
    scored.push({ candidate, score, reasons });
  }

  if (scored.length === 0) throw new Error('No eligible learner-owned experience');
  scored.sort((left, right) => right.score - left.score
    || (left.candidate.sortOrder ?? 0) - (right.candidate.sortOrder ?? 0)
    || left.candidate.id.localeCompare(right.candidate.id));
  const chosen = scored[0];
  if (scored.some((entry, index) => index > 0 && entry.score === chosen.score
    && (entry.candidate.sortOrder ?? 0) === (chosen.candidate.sortOrder ?? 0))) {
    chosen.reasons.push('deterministic tie-break');
  }
  return { experienceId: chosen.candidate.id, reasons: chosen.reasons };
}
