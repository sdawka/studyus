# Learning Science: Product Claims and Implementation Checklist

This document is the source of truth for the public `/how-it-works` page. It prevents a learning-science claim from becoming broader than the product behavior that supports it.

## Status Vocabulary

- **Implemented** — the learner can use the behavior end to end and its learning event is recorded where appropriate.
- **Partial** — a useful part of the principle is live, but the public copy must name the missing automation or constraint.
- **Student-controlled** — Studyus can scaffold the behavior, but must not claim to observe, enforce, or optimize it.

## Implementation Checklist

### 1. Retrieval before recognition — Implemented

- [x] Quick Quiz requires an answer before feedback (`src/lib/flows/quick_quiz.ts`, `src/components/tutor/QuickQuiz.svelte`).
- [x] Per-KC exercises grade MCQ and numeric answers server-side (`src/lib/domain/pedagogy/exercise.ts`).
- [x] Attempts append a `retrieval_practice` event on the targeted KC.
- [x] Practice appears in the learner's meta-skill readout (`src/components/profile/CapabilitiesPanel.svelte`).
- [ ] Do not claim that every quiz item is AI-generated: seeded exercise-bank items are preferred where present.

### 2. Distributed review — Partial

- [x] Mastery includes recency-sensitive evidence and idle decay (`src/lib/services/mastery.ts`).
- [x] The sweep creates `stale_kc` tasks for concepts that have not been practised recently (`src/lib/services/taskSweep.ts`).
- [x] Review activity is visible through task, concept, and profile surfaces.
- [ ] A personalized spaced-repetition interval scheduler is not shipped. Public copy must say resurfacing is live and exact interval optimization is planned.
- [ ] Do not claim a universal fixed spacing sequence; useful intervals depend on the desired retention period and learning context.

### 3. Match practice to the knowledge — Implemented

- [x] KCs use the five KLI types: fact, association, concept, rule, and principle.
- [x] Tutor mode derives from KC type, not from a generic difficulty label (`src/lib/services/tutor/modelSpec.ts`).
- [x] Course content supports typed scaffolds (`src/lib/content/courseContent.ts`).
- [x] Public wording names representative mappings without implying that one activity is always optimal.

### 4. Prerequisites and fading support — Implemented

- [x] The Understand flow loads prerequisite graphs and identifies not-ready prerequisites (`src/lib/domain/pedagogy/instruction.ts`).
- [x] A learner can verify weak prerequisites before continuing.
- [x] Seeded scaffolds include support levels and worked-example sequences.
- [x] The profile frontier shows unmastered KCs whose prerequisites are ready (`src/components/profile/FrontierPanel.svelte`).
- [ ] Do not claim that prerequisite state changes the mastery number; it gates recommendations and learning flow only.

### 5. Self-explanation and error correction — Implemented

- [x] Tutor modes and scaffold kinds include self-explanation.
- [x] The tutor can match a response to documented misconception probes.
- [x] Accepted corrections become first-class ledger items (`src/components/tutor/ScaffoldChat.svelte`, `src/pages/corrections.astro`).
- [x] Active corrections resurface until the learner marks them internalized.
- [ ] Public copy must keep the research caveat: self-explanation depends on prompt, domain, and target outcome.

### 6. Evidence over confidence — Implemented

- [x] Mastery is derived from instructional and assessment events rather than a user-selected traffic-light colour (`src/lib/services/mastery.ts`).
- [x] Event create, edit, and delete recompute the linked KC.
- [x] Capability status includes coverage so untouched KCs cannot disappear inside a high average (`src/lib/services/capabilities.ts`).
- [x] The raw event history remains visible and correctable.
- [ ] Mastery is a product heuristic, not a clinical, psychometric, BKT, or IRT estimate. Do not describe it as a probability that the learner “knows” something.

### 7. Varied and interleaved practice — Partial

- [x] Quick Quiz can include multiple KCs in one practice set.
- [x] The planner supports different activity types across a week.
- [x] Course-level next actions can span different concepts and study modes.
- [ ] Studyus does not yet select interleaved items using similarity or discrimination difficulty.
- [ ] Do not claim that random shuffling is beneficial interleaving.

### 8. Sustainable study conditions — Student-controlled

- [x] The planner can hold short study sessions and protected breaks.
- [x] Learner-authored rituals can shape a session (warm-up, retrieval, new material, reflect, break).
- [x] Ritual adherence uses plain done/skipped/upcoming counts without streak pressure.
- [ ] Studyus does not monitor sleep, circadian rhythm, room conditions, or device distraction.
- [ ] Do not score rest or turn well-being into a compliance metric.

## Adjacent Advice That Is Not a Product Claim

The following may be useful study guidance, but is not currently implemented as a distinct Studyus workflow:

- hierarchical note reduction into “essentials” or “nub” cards;
- ten-minute essay planning and academic paragraph architecture;
- automated removal of hedging from academic writing;
- circadian task scheduling;
- enforcement of a dedicated study environment or noise-control setup.

The public page must list these boundaries in its “What we leave to you on purpose” section. It must not imply that Studyus currently automates them.

## Evidence Base

- Dunlosky et al. (2013), *Improving Students’ Learning With Effective Learning Techniques*. <https://doi.org/10.1177/1529100612453266>
- Rowland (2014), *The effect of testing versus restudy on retention*. <https://doi.org/10.1037/a0037559>
- Cepeda et al. (2006), *Distributed practice in verbal recall tasks*. <https://doi.org/10.1037/0033-2909.132.3.354>
- Koedinger, Corbett, and Perfetti (2012), *The Knowledge–Learning–Instruction Framework*. <https://doi.org/10.1111/j.1551-6709.2012.01245.x>
- Brunmair and Richter (2019), *Similarity matters: A meta-analysis of interleaved learning and its moderators*. <https://doi.org/10.1037/bul0000209>
- Rittle-Johnson and Loehr (2017), *Eliciting explanations: Constraints on when self-explanation aids learning*. <https://doi.org/10.1080/00461520.2016.1196458>

## Maintenance Rule

When a learning behavior changes:

1. update this checklist;
2. update `docs/architecture/events-and-mastery.md` if the event or mastery semantics changed;
3. update the relevant row and status on `/how-it-works`;
4. verify that public copy still distinguishes implemented, partial, and student-controlled behavior.

## TODO

- Replace generic resurfacing with a validated, personalized spacing policy before changing principle 2 to **Implemented**.
- Add similarity-aware interleaving before changing principle 7 to **Implemented**.
- Add automated link checking for the public evidence references.
