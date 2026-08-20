// "Understand next" selection for the course home (task-oriented overview):
// the handful of KCs most worth a deep-work absorb session (/learn/[kcId])
// right now. Two pools, both excluding mastered KCs:
//  - weak: started (mastery > 0) — lowest mastery first, staleness (oldest
//    lastEventAt) breaking ties, then a stable partition sinking ZPD-blocked
//    KCs below unblocked ones (never hard-excluded — see `unreadyPrereqs`);
//  - new: untouched (mastery 0) in the caller's order (branch/KC sortOrder,
//    i.e. curriculum order), same unblocked-first stable partition — guaranteed
//    one slot whenever any exists, so a course you're behind on still points
//    forward, not only backward.
// The "idle Nd" annotation mirrors taskSweep's stale_kc 7-day threshold but
// is display-only — no tasks are minted here (the sweep already does that).
export interface UnderstandNextKc {
  id: string;
  name: string;
  mastery: number;
  status: string | null;
  lastEventAt: number | null;
  // ZPD readiness (src/lib/zpd.ts): this KC's not-yet-ready prerequisites
  // (id + name, so the UI can link to them), merged in by the course page
  // from getCourseReadiness. Absent (undefined) is treated as unblocked —
  // every existing caller that predates ZPD keeps its exact prior behavior.
  unreadyPrereqs?: { id: string; name: string }[];
}

export interface UnderstandNextPick {
  kc: UnderstandNextKc;
  reason: 'weak' | 'new';
  // Days since the KC's last event, populated only at/past the stale
  // threshold (a KC touched yesterday isn't worth an "idle" nag).
  idleDays: number | null;
  // Not-yet-ready prerequisites blocking this pick; empty when unblocked
  // (or when readiness wasn't supplied at all).
  blockedBy: { id: string; name: string }[];
}

function blockedByOf(kc: UnderstandNextKc): { id: string; name: string }[] {
  return kc.unreadyPrereqs ?? [];
}

function isBlocked(kc: UnderstandNextKc): boolean {
  return blockedByOf(kc).length > 0;
}

// Stable partition: unblocked KCs first, blocked ones sunk to the end,
// preserving each group's relative order — Array#sort is spec-guaranteed
// stable, so sorting solely on the blocked flag never reshuffles within a
// group already ordered by the caller (mastery/staleness, or curriculum
// order).
function sinkBlocked<T extends UnderstandNextKc>(kcs: T[]): T[] {
  return [...kcs].sort((a, b) => Number(isBlocked(a)) - Number(isBlocked(b)));
}

export const UNDERSTAND_NEXT_LIMIT = 4;
export const UNDERSTAND_STALE_DAYS = 7;

const DAY_MS = 86_400_000;

function idleDaysOf(kc: UnderstandNextKc, now: number): number | null {
  if (kc.lastEventAt === null) return null;
  const days = Math.floor((now - kc.lastEventAt) / DAY_MS);
  return days >= UNDERSTAND_STALE_DAYS ? days : null;
}

export function selectUnderstandNext(
  kcs: UnderstandNextKc[],
  now: number = Date.now(),
  limit: number = UNDERSTAND_NEXT_LIMIT,
): UnderstandNextPick[] {
  const notMastered = kcs.filter((k) => k.status !== 'mastered');

  const weak = sinkBlocked(
    notMastered
      .filter((k) => k.mastery > 0)
      .sort((a, b) => a.mastery - b.mastery || (a.lastEventAt ?? 0) - (b.lastEventAt ?? 0)),
  );
  // "new" pool stays in curriculum order but sinks blocked KCs the same
  // way — the reserved slot picks the first *unblocked* untouched KC,
  // falling back to a blocked one only when every fresh KC is blocked.
  const fresh = sinkBlocked(notMastered.filter((k) => k.mastery === 0));

  const reservedForNew = fresh.length > 0 ? 1 : 0;
  const weakPicks = weak.slice(0, Math.max(0, limit - reservedForNew));
  const freshPicks = fresh.slice(0, limit - weakPicks.length);

  return [
    ...weakPicks.map((kc) => ({ kc, reason: 'weak' as const, idleDays: idleDaysOf(kc, now), blockedBy: blockedByOf(kc) })),
    ...freshPicks.map((kc) => ({ kc, reason: 'new' as const, idleDays: null, blockedBy: blockedByOf(kc) })),
  ];
}
