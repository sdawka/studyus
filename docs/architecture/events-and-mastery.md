# Events & Mastery: The KLI Framework

This document distills **Koedinger, Corbett & Perfetti's Knowledge-Learning-Instruction (KLI) Framework** (Cognitive Science 36(5), 2012; [PDF](http://pact.cs.cmu.edu/pubs/Koedinger,%20Corbett,%20Perfetti%202012-KLI.pdf)) and explains how studyus's event model and mastery inference implement it.

## Ontology: KCs, Events, and Performance

The foundational insight: **Knowledge Components (KCs) cause performance.** A KC is an "acquired unit of cognitive function inferable from performance on related tasks" — a fact, concept, procedure, or principle that a learner can apply.

Three types of observable events drive learning:

1. **Instructional Events (IE)**: Teacher-planned, observable actions that *intend* to cause learning.
   - Lecture (student attends), tutorial video, reading, worked example, teacher explanation.
   - Create opportunity for *Learning Events* (unobservable, internal cognitive changes).
   
2. **Learning Events (LE)**: Unobservable. Never recorded. The internal cognitive process of acquiring or refining a KC.
   - Memory formation, fluency-building, conceptual integration, schema induction, model refinement.
   - Caused by Instructional Events; measured indirectly via Assessment Events.

3. **Assessment Events (AE)**: Evaluated responses that measure KC acquisition.
   - Quiz, homework problem, exam, self-report confidence.
   - Reveal performance, which reveals learning.

**Critical insight**: A single interaction is often **both IE and AE simultaneously**. A tutored problem step gives feedback (instruction) AND records whether the student got it right (assessment). So instead of categorizing events as "instructional" or "assessment," studyus uses **dual-role boolean flags**: `is_instructional`, `is_assessment`.

Examples:
- `lecture_attended`: IE=true, AE=false (instruction only; no performance measure).
- `quiz_taken`: IE=false, AE=true (pure measurement; no explicit instruction in the event itself).
- `tutor_session`: IE=true, AE=true (feedback given AND correctness/confidence recorded).

## KC Taxonomy: Application & Response Conditions

KLI defines KCs by two axes:

- **Application condition**: constant (same setup every time) vs. variable (different contexts).
- **Response type**: constant (e.g., "recite the formula") vs. variable (apply it).

This yields a taxonomy aligned to learning process and instructional method:

### fact
- Constant application, constant response, verbal.
- E.g., "Avogadro's number is 6.022 × 10²³."
- Learning process: **memorization & rote fluency-building**.
- Instruction: **spaced retrieval drills, repetition, mnemonic devices**.

### association
- Constant application, constant response, non-verbal.
- E.g., recognizing a spectroscopy peak as an aromatic C-H stretch.
- Learning process: **fluency-building via repeated exposure**.
- Instruction: **matching exercises, pattern drills, flashcards**.

### concept
- Variable application, constant response (classification).
- E.g., "Identify whether a given reaction is SN1 or SN2."
- Learning process: **induction & refinement** (building a mental model of the concept boundaries).
- Instruction: **feature-focusing feedback, contrast examples, timely error correction, classification tasks**.

### rule
- Variable application, variable response (procedure, algorithm, schema).
- E.g., "Draw the mechanism for an SN1 reaction given the starting material and solvent."
- Learning process: **induction, refinement, proceduralization** (learning when and how to apply the procedure).
- Instruction: **worked examples with step fading, scaffolded practice, explicit procedure instruction**.

### principle
- Variable application, variable response, with verbal rationale.
- E.g., "Derive the Navier-Stokes equations from conservation of momentum."
- Learning process: **sense-making, understanding, model-building** (why the procedure works).
- Instruction: **self-explanation, interactive models, conceptual discussions, derivation walkthroughs**.

## Learning Processes

KLI identifies distinct cognitive processes that build KCs:

- **Memory & fluency-building**: Strengthening recall speed and automaticity for facts and associations (applies to all types).
- **Induction & refinement**: Building mental models from examples; narrowing/broadening category boundaries (variable-condition types: concept, rule, principle).
- **Understanding & sense-making**: Integrating rationale, causal models, and deep structure (primarily for principle; also rule with explanation).

## Instruction Matching (Asymmetry Hypothesis)

KLI predicts that instructional effectiveness *asymmetrically depends on KC type*:

- **Simple instructional methods** (e.g., spaced retrieval, immediate feedback, optimized scheduling) remain effective for *all* KC types, even complex ones.
- **Complex instructional methods** (e.g., self-explanation, worked examples with heavy scaffolding) provide little benefit for simple KC types (facts, associations).

Consequence: **Spaced retrieval is safe universally**. Every tutor mode ends with a retrieval prompt. But sense-making instruction is gated on KC type.

## Tutor Modes (studyus Implementation)

studyus's tutor selects a mode based on `kc_type`:

| kc_type | Mode | Method | Typical Flow |
|---------|------|--------|--------------|
| `fact` | `recall` | Spaced retrieval; quiz-style flashcard | Q: "Avogadro's number?" A: [text input] Feedback: correct/incorrect. Repeat with spacing. |
| `association` | `recall` | Pattern drill, visual matching | Q: "Match spectroscopy peak to functional group." A: [multiple-choice]. Feedback + spacing. |
| `concept` | `classify` | Classification exercises with feature-focusing feedback | Q: "Is this reaction SN1 or SN2? (solvent: X, leaving group: Y, ...)" A: [choice]. Feedback highlights discriminative features. Repeat with varied conditions. |
| `rule` | `worked_example` | Worked example with step fading → guided practice → independent practice | Phase 1: Show complete solution. Phase 2: Student completes last N steps. Phase 3: Student solves solo. Minimal self-explanation at first; increase as learner improves. |
| `principle` | `self_explain` + `interactive_model` | Self-explanation dialogue AND/OR parameter adjustment on a live model | Mode A: "Explain why Bernoulli's equation holds when we change velocity." Student writes; tutor probes. Mode B: Model with sliders (velocity, height, pressure); student predicts relation; tutor reveals correct. |

## Mastery Measurement (CMU DataShop Convention — conceptual framing, not what shipped)

CMU's DataShop convention for measuring mastery is opportunity-count + first-attempt error rate:

### Opportunity Count
For each (learner, KC), count the number of *independent attempts* on tasks involving that KC. This allows comparison across learners and tracking of learning curves.

### Error Rate
On the *first attempt* of a task involving a KC:
- **Error**: student response was incorrect OR student requested a hint.
- **Success**: student response was correct on first attempt, no hint requested.
- Error rate = (errors) / (total opportunities) on that KC.

### Learning Curves
Plot error rate vs. opportunity count. Typical pattern: exponential decay (fewer errors as practice accumulates).

**This is background/inspiration, not an implementation description.** The shipped fold (below) has no opportunity-count bookkeeping, no first-attempt/hint distinction, and no learning-curve computation — it folds every assessment-role event's payload success value into one recency-weighted average, uniformly regardless of attempt order. Read the next section for what `mastery.ts` actually computes.

### The Shipped Fold (Mastery Score Derivation)

**Re-derived 2026-08-15 directly from `src/lib/services/mastery.ts::foldMastery`** — the prior "studyus v1 Fold" sketch below this heading (first-attempt success, 45-day idle threshold, 85/50/20 status bands) was never implemented; this section now describes the code that actually shipped. All constants live in one place, `MASTERY_CONSTANTS` in that file — this doc intentionally doesn't restate the numbers as prose that could drift from them again; read the file for the current values, or `docs/api.md`'s "Mastery fold (reference)" section for the same summary kept in sync with it.

**The fold is a pure function**: `foldMastery(events, now) -> { mastery, status, lastEventAt }`, re-run in full on every event create/update/delete — no incremental state, no first-attempt/opportunity-count bookkeeping.

1. **AE component**: every event with `is_assessment=true` contributes a `[0,1]` success value read from its payload — `payload.correct` (boolean), else `payload.correctness` (number, clamped), else `payload.score / 100`, else `payload.self_rating / 5`, else a neutral default (`DEFAULT_AE_SUCCESS`) when none of those are present. Each contribution is weighted by recency (`recencyWeight`, half-life `RECENCY_HALF_LIFE_MS`) — an exponential `0.5 ** (age / halfLife)`, not the exponential-decay-to-a-`tau` formula a prior draft described. The AE component is the recency-weighted average of these values, scaled to 0–100.
2. **IE bump**: every event with `is_instructional=true` adds `IE_BUMP_POINTS` (recency-weighted the same way), summed and capped at `IE_BUMP_CAP` total — exposure alone can raise mastery but never past that cap.
3. **Idle decay**: the combined raw score (`AE component + IE bump`, itself capped at 100) is pulled toward `IDLE_DECAY_FLOOR_RATIO` of itself with half-life `IDLE_DECAY_HALF_LIFE_MS` since the single most recent event of any kind (`lastEventAt`) — a continuous exponential blend (`raw * decayFactor + raw * floorRatio * (1 - decayFactor)`), not a "no events in N days, then decay" step function. There is no separate 45-day idle *threshold* — decay is continuous from the moment of the last event.
4. **Status**: a plain threshold read of the final decayed number — `not-started` (zero events at all), `learning` (< `REVIEW_THRESHOLD`), `review` (`REVIEW_THRESHOLD` to `MASTERED_THRESHOLD - 1`), `mastered` (≥ `MASTERED_THRESHOLD`). As of this writing that's learning < 40, review 40–79, mastered ≥ 80 — read `MASTERY_CONSTANTS` for the authoritative values rather than trusting this restatement if it's been edited since.

There is no first-attempt/opportunity-count logic, no per-type success-threshold table (quiz ≥80%, tutor `final_rating >= 3`, etc.) — every AE event's success value comes from whatever the payload actually carries, uniformly, regardless of event `type`.

**Recomputation**: the fold is cached on the `kcs.mastery`/`kcs.status`/`kcs.last_event_at` columns. Every event write (create, edit, delete) re-queries the full event list for the affected KC and re-folds it in the same `db.batch` as the write — atomic, and correct for edits/deletes because the fold is pure and takes the complete list each time (`recomputeKcMastery` in `mastery.ts`; the events service inlines the same pure `foldMastery` call inside its own batch instead of calling that wrapper, since it needs the recompute atomic with the event mutation).

### assessment_kcs.qmatrix_version

The KC-to-assessment mapping (`assessment_kcs`) includes a `qmatrix_version` column, auto-incremented (`services/assessments.ts`) every time an assessment's `kc_ids` are replaced via `PATCH /assessments/:id`. **This is write-only today** — nothing consumes `qmatrix_version` anywhere in the codebase (verified 2026-08-15; it's stored on insert and read back only to compute its own increment on update — no other reader exists). The mastery fold itself doesn't consult it at all: `foldMastery` operates purely on an individual KC's own `events` rows (via `events.kc_id`, not through `assessment_kcs`), so an assessment's KC-mapping history has no bearing on how that KC's events are folded. The "handles historical consistency" behavior this column was intended to enable is aspirational, not implemented — treat this as a versioned-but-unconsumed audit trail unless/until something reads it.

## TODO

- **AFM (Additive Factors Model)**: Extend the fold to estimate per-KC learning rate and per-instructional-method effectiveness.
- **BKT (Bayesian Knowledge Tracing)**: State-space model of KC mastery with guess/slip parameters; probabilistic inference.
- **Spaced-repetition scheduler**: Recommend review timing based on forgetting curve and mastery uncertainty.
- **Prerequisite modeling**: Use knowledge-map edges to adjust mastery inference (e.g., struggling with Bernoulli may indicate weak Pressure KC).
