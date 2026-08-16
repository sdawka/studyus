// "Understand next" selection for the course home (task-oriented overview):
// the handful of KCs most worth a deep-work absorb session (/learn/[kcId])
// right now. Two pools, both excluding mastered KCs:
//  - weak: started (mastery > 0) — lowest mastery first, staleness (oldest
//    lastEventAt) breaking ties;
//  - new: untouched (mastery 0) in the caller's order (branch/KC sortOrder,
//    i.e. curriculum order) — guaranteed one slot whenever any exists, so a
//    course you're behind on still points forward, not only backward.
// The "idle Nd" annotation mirrors taskSweep's stale_kc 7-day threshold but
// is display-only — no tasks are minted here (the sweep already does that).
export interface UnderstandNextKc {
  id: string;
  name: string;
  mastery: number;
  status: string | null;
  lastEventAt: number | null;
}

export interface UnderstandNextPick {
  kc: UnderstandNextKc;
  reason: 'weak' | 'new';
  // Days since the KC's last event, populated only at/past the stale
  // threshold (a KC touched yesterday isn't worth an "idle" nag).
  idleDays: number | null;
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

  const weak = notMastered
    .filter((k) => k.mastery > 0)
    .sort((a, b) => a.mastery - b.mastery || (a.lastEventAt ?? 0) - (b.lastEventAt ?? 0));
  const fresh = notMastered.filter((k) => k.mastery === 0);

  const reservedForNew = fresh.length > 0 ? 1 : 0;
  const weakPicks = weak.slice(0, Math.max(0, limit - reservedForNew));
  const freshPicks = fresh.slice(0, limit - weakPicks.length);

  return [
    ...weakPicks.map((kc) => ({ kc, reason: 'weak' as const, idleDays: idleDaysOf(kc, now) })),
    ...freshPicks.map((kc) => ({ kc, reason: 'new' as const, idleDays: null })),
  ];
}
