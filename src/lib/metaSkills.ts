// Pure fold: (raw activity signals, now) -> per-metaskill { count_28d,
// count_prior_28d, trend, last_at } for the fixed 3-item META_SKILL_KEYS
// catalog (src/lib/schemas/capabilities.ts). Deliberately frequency/trend,
// never a 0-100 score (KLI honesty + anti-gamification, vision.md) — see
// src/lib/services/capabilities.ts::getMetaSkills for how the underlying
// events/tutor_conversations/user_corrections rows get turned into the
// `MetaSkillSignal[]` this module folds.
import { META_SKILL_KEYS, type MetaSkill, type MetaSkillKey } from './schemas/capabilities';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 28 * DAY_MS;
// A window-over-window swing of at most this many events reads as noise,
// not a real trend — keeps a single extra retrieval session from flipping
// the arrow.
const FLAT_BAND = 1;

export type MetaSkillSignal = { key: MetaSkillKey; ts: number };

function trendFor(count28d: number, countPrior28d: number): MetaSkill['trend'] {
  const diff = count28d - countPrior28d;
  if (Math.abs(diff) <= FLAT_BAND) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

export function foldMetaSkills(signals: MetaSkillSignal[], now: number = Date.now()): MetaSkill[] {
  const byKey = new Map<MetaSkillKey, number[]>(META_SKILL_KEYS.map((key) => [key, []]));
  for (const signal of signals) {
    byKey.get(signal.key)?.push(signal.ts);
  }

  return META_SKILL_KEYS.map((key) => {
    const timestamps = byKey.get(key) ?? [];

    let count28d = 0;
    let countPrior28d = 0;
    let lastAt: number | null = null;

    for (const ts of timestamps) {
      const age = now - ts;
      if (age >= 0 && age < WINDOW_MS) count28d += 1;
      else if (age >= WINDOW_MS && age < 2 * WINDOW_MS) countPrior28d += 1;

      if (lastAt === null || ts > lastAt) lastAt = ts;
    }

    return {
      key,
      count_28d: count28d,
      count_prior_28d: countPrior28d,
      trend: trendFor(count28d, countPrior28d),
      last_at: lastAt === null ? null : new Date(lastAt).toISOString(),
    };
  });
}
