# ADR-004: Event-Sourced Mastery Inference

**Status**: Accepted

> **2026-08-15 erratum**: the shipped fold (`src/lib/services/mastery.ts::foldMastery`) differs from this ADR's "Fold Algorithm (v1)" sketch below in several material ways — there is no first-attempt-correctness bookkeeping (every AE event's payload success value counts, not just a first attempt), the exposure prior is `+4` points per instructional event capped at `+15` (not "+5% per IE, capped... doesn't exceed 30%"), and idle decay is a continuous exponential blend toward a 50% floor from the moment of the last event (not a 45-day-threshold step function). The "Mastery Deltas" response shape and dual-role-flag design below are accurate and unchanged. For the authoritative algorithm and current constants, see `docs/architecture/events-and-mastery.md`'s "The Shipped Fold" section and `mastery.ts::MASTERY_CONSTANTS` directly — this ADR's Fold Algorithm section is left below as a historical record of the original design intent, not a description of current behavior.

**Decision**: Mastery is never stored as ground truth; it's derived from an append-mostly event log via a pure fold function.

## Context

studyus tracks learning via **KLI framework**: Knowledge Components acquire through events (instructional, assessment). Mastery must:
- Reflect recent performance (recency matters).
- Include exposure from instruction (not just assessment).
- Allow manual event edits (typos, late grades).
- Support offline/agentic event recording.

Alternatives:
- **Direct mastery updates**: Simplest, but loses history.
- **Mastery snapshots + event log**: Requires version tracking; harder to recompute.
- **Pure event log**: Simple, but every query recomputes (slow).

## Decision

**Event-sourced mastery**:
- One `events` table, append-mostly but editable for manual entries.
- Mastery cached on `kcs.mastery` (0–100, recomputed on event write).
- Fold is pure: `events[] → mastery 0-100` (deterministic, testable).
- Recompute happens in the same `db.batch` as event write (atomic).

## Dual-Role Flags

Instead of categorizing events as "instructional" or "assessment":
- Every event has `is_instructional` and `is_assessment` booleans.
- Rationale: A tutor interaction is *both* (feedback + correctness).
- Examples:
  - `lecture_attended`: `is_instructional=true, is_assessment=false`.
  - `quiz_taken`: `is_instructional=false, is_assessment=true`.
  - `tutor_session`: `is_instructional=true, is_assessment=true`.

## Fold Algorithm (v1)

```
for each (user, KC):
  1. Filter events to is_assessment=true, matching KC
  2. For each event, compute success (first-attempt correct?)
  3. Apply recency weighting (exp decay, tau=30 days)
  4. Compute weighted first-attempt success rate
  5. Add exposure prior from is_instructional events (+5% per IE, capped)
  6. Apply idle decay if no events in 45 days
  7. Clamp 0–100, determine status
```

Cached on `kcs.mastery`; index on (user_id, branch_id) for rollups.

## Editable Events + Recompute

Manual events (recorded outside the app) can be edited or deleted:
- Edit: user notices typo after entry (e.g., wrong date, wrong KC).
- Delete: event was a duplicate.
- System events (session, tutor, seed) are delete-only + require confirmation.

Every mutation triggers recompute for affected KCs.

## Consequences

**Positive:**
- Complete auditability: every change is in the log.
- Offline-friendly: can batch events, replay on sync.
- Supports agentic event recording (Telegram quiz → event append).
- Pure fold is testable (unit test: event sequence → expected score).

**Negative:**
- Recompute is O(events) per KC; caching is essential.
- Complex business logic in the fold; must be carefully designed.
- Event editing breaks immutability (but tolerable for manual entries).

## Mastery Deltas

When an event write triggers a recompute, the response includes `mastery_deltas`:
```json
[
  { "kc_id": "...", "old_mastery": 60, "new_mastery": 65 },
  { "kc_id": "...", "old_mastery": 75, "new_mastery": 78 }
]
```

Clients use this to update KCs, branches, and course mastery displays.

## TODO

- AFM/BKT: Advanced mastery models.
- Spaced-repetition scheduler: Recommend review timing.
- Prerequisite-aware fold: Factor in mastery of prerequisite KCs.

See `docs/architecture/events-and-mastery.md` for full KLI distillation.
