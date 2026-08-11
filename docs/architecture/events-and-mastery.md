# Events & Mastery: The KLI Framework

This document distills **Koedinger, Corbett & Perfetti's Knowledge-Learning-Instruction (KLI) Framework** (Cognitive Science 36(5), 2012; [PDF](http://pact.cs.cmu.edu/pubs/Koedinger,%20Corbett,%20Perfetti%202012-KLI.pdf)) and explains how StudyBuddy's event model and mastery inference implement it.

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

**Critical insight**: A single interaction is often **both IE and AE simultaneously**. A tutored problem step gives feedback (instruction) AND records whether the student got it right (assessment). So instead of categorizing events as "instructional" or "assessment," StudyBuddy uses **dual-role boolean flags**: `is_instructional`, `is_assessment`.

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

## Tutor Modes (StudyBuddy Implementation)

StudyBuddy's tutor selects a mode based on `kc_type`:

| kc_type | Mode | Method | Typical Flow |
|---------|------|--------|--------------|
| `fact` | `recall` | Spaced retrieval; quiz-style flashcard | Q: "Avogadro's number?" A: [text input] Feedback: correct/incorrect. Repeat with spacing. |
| `association` | `recall` | Pattern drill, visual matching | Q: "Match spectroscopy peak to functional group." A: [multiple-choice]. Feedback + spacing. |
| `concept` | `classify` | Classification exercises with feature-focusing feedback | Q: "Is this reaction SN1 or SN2? (solvent: X, leaving group: Y, ...)" A: [choice]. Feedback highlights discriminative features. Repeat with varied conditions. |
| `rule` | `worked_example` | Worked example with step fading → guided practice → independent practice | Phase 1: Show complete solution. Phase 2: Student completes last N steps. Phase 3: Student solves solo. Minimal self-explanation at first; increase as learner improves. |
| `principle` | `self_explain` + `interactive_model` | Self-explanation dialogue AND/OR parameter adjustment on a live model | Mode A: "Explain why Bernoulli's equation holds when we change velocity." Student writes; tutor probes. Mode B: Model with sliders (velocity, height, pressure); student predicts relation; tutor reveals correct. |

## Mastery Measurement (CMU DataShop Convention)

StudyBuddy adopts CMU's DataShop conventions for measuring mastery:

### Opportunity Count
For each (learner, KC), count the number of *independent attempts* on tasks involving that KC. This allows comparison across learners and tracking of learning curves.

### Error Rate
On the *first attempt* of a task involving a KC:
- **Error**: student response was incorrect OR student requested a hint.
- **Success**: student response was correct on first attempt, no hint requested.
- Error rate = (errors) / (total opportunities) on that KC.

### Learning Curves
Plot error rate vs. opportunity count. Typical pattern: exponential decay (fewer errors as practice accumulates).

### StudyBuddy v1 Fold (Mastery Score Derivation)

**The fold is a pure function**: given a list of events for a (user, KC), compute a mastery score 0–100.

1. **Filter to Assessment Events with kc_id**: Collect all events where `is_assessment=true` and `kc_id` matches.
2. **Group by session/attempt**: Order chronologically.
3. **First-attempt success**: For each independent problem/quiz/task, was the first attempt correct?
   - From `quiz_taken`: score ≥ 80% → success. (TODO: configurable threshold)
   - From `assignment_graded`: success if student's submission earned ≥ 80% of max grade.
   - From `tutor_session`: success if `payload.final_rating >= 3` (3–5 scale) OR `payload.mode="recall"` and student responded correctly.
   - Self-reported `self_assessment`: confidence ≥ 70% → success.
4. **Recency weighting** (exponential decay):
   - Recent successes matter more. Apply exponential weight: `w(t) = exp(-(now - t_event) / tau)` where `tau = 30 days`.
   - Weighted success rate: `sum(successes * w(t)) / sum(w(t))`.
5. **Exposure prior from Instructional Events**:
   - Count IE-role events (lecture_attended, reading_done, etc.) with this KC.
   - Each adds a small prior boost: +5% per IE (capped; doesn't exceed 30% boost).
   - Rationale: exposure without assessment is weak but non-zero signal.
6. **Idle drift**:
   - If no events (AE or IE) in the last 45 days, apply exponential decay to the score.
   - `decayed_score = current_score * exp(-(days_idle - 45) / 30)`.
   - Rationale: KCs fade from disuse.
7. **Clamp to 0–100**, determine `status`:
   - `mastery ≥ 85%`: `status = "mastered"`.
   - `mastery ≥ 50%`: `status = "in_progress"`.
   - `mastery >= 20%`: `status = "in_progress"`.
   - `mastery < 20%`: `status = "not_started"`.

**Recomputation**: The fold is cached on the `kcs.mastery` column. Every event write (create, edit, delete) triggers a recompute for affected KCs in the same `db.batch` transaction — ensuring atomicity.

### assessment_kcs.qmatrix_version

The KC-to-assessment mapping (`assessment_kcs`) includes a `qmatrix_version` column. If the mapping evolves (a new KC is added to an assessment, or an old one removed), increment the version. This allows the fold to handle historical consistency: events from before the mapping change are not re-interpreted.

## TODO

- **AFM (Additive Factors Model)**: Extend the fold to estimate per-KC learning rate and per-instructional-method effectiveness.
- **BKT (Bayesian Knowledge Tracing)**: State-space model of KC mastery with guess/slip parameters; probabilistic inference.
- **Spaced-repetition scheduler**: Recommend review timing based on forgetting curve and mastery uncertainty.
- **Prerequisite modeling**: Use knowledge-map edges to adjust mastery inference (e.g., struggling with Bernoulli may indicate weak Pressure KC).
