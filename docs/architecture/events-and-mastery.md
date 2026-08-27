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

The KC-to-assessment mapping (`assessment_kcs`) includes a `qmatrix_version` column, auto-incremented (`services/assessments.ts`) every time an assessment's `kc_ids` are replaced via `PATCH /assessments/:id`. **This is write-only today** — nothing consumes `qmatrix_version` anywhere in the codebase (verified 2026-08-15; it's stored on insert and read back only to compute its own increment on update — no other reader exists). The mastery fold itself doesn't consult it at all: `foldMastery` operates purely on an individual KC's own `events` rows (via `events.kc_id`, not through `assessment_kcs`), so an assessment's KC-mapping history has no bearing on how that KC's events are folded. The "handles historical consistency" behavior this column was intended to enable is aspirational, not implemented — treat this as a versioned-but-unconsumed audit trail unless/until something reads it. (The `assessment_kcs` row linkage itself — which KCs an assessment links to, as opposed to `qmatrix_version` — is not similarly unconsumed: the assessments service reads it at grade-entry write time, `PATCH /assessments/:id` setting `grade_received`, to fan out one assessment-role event per linked KC, docs/api.md's grade-entry section. The fold still never reads `assessment_kcs` directly either way — it only ever sees the individual `events` rows that fan-out produced.)

## ZPD: The Learning Frontier (v1.9)

Vygotsky's **zone of proximal development** — what a learner can do next with the scaffolding already in place, as distinct from what they can already do alone (mastered) or can't yet attempt productively (still blocked on a prerequisite). studyus grounds this directly in the prereq-DAG machinery `kc_edges` already models (see `data-model.md`'s `kc_edges` section and this doc's "Prerequisite modeling" TODO below, which this section resolves): a KC's **readiness** is the same threshold the absorb flow's prerequisite check already uses (`tutor.md`'s "Prerequisite check": `ready = status !== 'not-started' && mastery >= MASTERY_CONSTANTS.REVIEW_THRESHOLD`) — one definition, exported as `isReady` from `src/lib/services/knowledgeMap.ts` and reused everywhere readiness matters, not redefined per caller.

The **frontier** is every unmastered KC whose *every* prerequisite is ready (vacuously true for a KC with no prerequisites at all) — the KCs genuinely worth tackling next. A KC with at least one not-yet-ready prerequisite is **blocked**, not frontier, even if its own mastery is otherwise low; a `mastered` KC is excluded from both sets, since there's nothing left to reach for. This is a pure computation (`src/lib/zpd.ts::selectFrontier`) over `kcs` + `kc_edges` rows a caller supplies — **zero persistence**, no new table, no cached closure: `src/lib/services/zpd.ts` re-derives the frontier from scratch on every read (`getGlobalFrontier` for the whole-profile view across all non-archived courses, `getCourseReadiness` for one course, loading one hop of out-of-course prerequisites so a cross-course prereq still gates correctly without a full transitive walk).

Two consumers read this the same way: `GET /api/v1/profile/frontier` surfaces it on `/profile` (replacing the old "Global knowledge map — coming later" stub) grouped by course, each frontier KC linking into `/learn/[kcId]`; and `understandNext.ts`'s course-level picker merges per-KC readiness in (`UnderstandNextKc.unreadyPrereqNames`, optional so every existing caller/test that doesn't supply it keeps its old behavior) so the "new" slot prefers an unblocked untouched KC over a blocked one, and the weak pool sinks blocked picks below unblocked ones instead of hiding them outright — a blocked KC is still worth knowing about, just not the first thing to reach for. `UnderstandNext.svelte` renders this as "unlocks after ⟨prerequisite name⟩" rather than a bare gray-out, naming the specific thing standing in the way.

## Global Next Move: Deterministic Learning Triage

`GET /api/v1/profile/next-move` builds a fresh, learning-only read model from
active owned KCs, prerequisite edges, ungraded dated assessments in the next 30
days, and active authored MCQ counts. It does not read or create tasks: Today
Tasks remains the source of truth for obligations and administrative work.

The pure ranker in `src/lib/nextMove.ts` scores each deduplicated actionable KC
as `0.40 assessment urgency + 0.30 mastery need + 0.20 recency + 0.10
prerequisite leverage`. Assessment weight breaks otherwise equal choices; it
does not override the score. A blocked assessment KC recursively redirects to
its first actionable prerequisite, including across owned active courses, and
an impossible/cyclic downstream target is never surfaced. The response returns
one recommendation and at most two alternatives with human-readable reason
codes. It is computed on every read—no recommendation table, cache, or mastery
mutation.

The 15/25/50-minute choice determines action shape rather than changing the
score. A ready/review KC with enough active authored MCQs launches an exact-KC
3/5/8-question Quick Quiz; otherwise it launches the existing guided Understand
flow with the time budget included in tutor context. Following or cycling past
a recommendation appends `recommendation_followed` or
`recommendation_ignored`. Both are context-only event types, so the mastery fold
ignores them arithmetically and they do not refresh `kcs.last_event_at`.

## Capabilities: Competencies and Meta-Skills (v1.9)

Two distinct layers share the "capability" word (a doc-only naming collision — `docs/architecture/overview.md` and `agentic-channels.md` reword their unrelated "every capability is a pure function" phrasing to "service function" to avoid the clash; see `data-model.md`'s glossary note):

**Competencies** are higher-order aggregates of KCs, deliberately allowed to cross course boundaries (e.g. "quantitative modeling" spanning both a fluid-mechanics and a thermodynamics course) — the KLI framework itself is KC-scoped, but a learner's actual skill often isn't, and a course-scoped rollup alone would miss that. A competency's derived mastery (`src/lib/capabilityMastery.ts::foldCapabilityMastery`) is a weighted mean of its member KCs' own event-sourced mastery (weight from `capability_kcs.weight`, default 1) plus a `coverage` figure (the fraction of members that have any events at all) — **not** a second independent fold over raw events. `status` reuses the same `MASTERY_CONSTANTS` thresholds as a plain KC, with one addition: `mastered` also requires `coverage === 1`, so a nine-member competency can't read "mastered" off two members with high scores and seven never touched. Authoring is seed-first (`courses/capabilities.json`, `source: 'seed'`; `source: 'user'` is schema-ready but has no UI yet — see `courses/content-schema.md`'s Capabilities section for the file format).

**Meta-skills** are metacognitive learning-strategy signals — retrieval practice, self-explanation, error analysis — the "how you study" layer KLI's KC taxonomy doesn't touch at all. They are a **fixed catalog of exactly three**, always derived from existing activity (`src/lib/services/capabilities.ts::getMetaSkills` reads `events`, `tutor_conversations`, and `user_corrections`; `src/lib/metaSkills.ts::foldMetaSkills` folds the raw timestamps), never stored, and never a 0–100 score: each skill reports `count_28d` / `count_prior_28d` / `trend` (`up`/`flat`/`down`, a ±1-event band around zero to keep one extra session from flipping the arrow) / `last_at`. This is deliberate KLI honesty plus the anti-gamification stance (`docs/product/vision.md`) — a frequency-and-trend readout invites "am I doing this at all," not a leaderboard number to chase. Retrieval practice counts `retrieval_practice`/`quiz_taken`/`self_assessment` events; self-explanation counts `self_explain`-mode tutor conversations plus `taught_someone` events (explaining to someone else is the same generative skill); error analysis counts accepted `user_corrections` rows plus "failed-then-later-passed" recoveries walked per-KC over time-ordered assessment events.

## Rituals: Deliberate Practice and Self-Regulation (v1.9)

A **ritual** is a learner-authored structure around studying, in either (or both) of two forms — `kind: 'recurring' | 'session_shape' | 'both'`:

- **Recurring** rituals are a scheduled habit ("Sunday weekly review," a daily flashcard pass) — the deliberate-practice literature's point that consistent, structured repetition beats ad-hoc effort. The sweep's `collectRituals` collector (`services/taskSweep.ts`, the ritual family's master toggle in `settings.task_generators.ritual`) mints one task per occurrence with dedupe key `ritual:<ritualId>:<yyyymmdd>`, the same idempotent-generator idiom every other sweep family uses.
- **Session-shape** rituals are in-session structure — a warm-up → retrieval → new-material → reflect rail a student picks at the start of a `StudyFlow` session — the self-regulated-learning move of imposing a deliberate structure on a study block instead of open-ended time-on-task. The step rail is **guidance, not an enforced gate**: `steps` renders as a suggested order (`'retrieval'` links to QuickQuiz, `'new_material'` to `/learn/[kcId]`, `'game'` to the course's `/play` tab, `'reflect'` reuses the existing session reflection field), and a student can freely ignore it.

Adherence is **computed on read, never stored** (no adherence table, per ADR-004): recurring adherence folds the trailing-28-day window of sweep-minted `ritual` tasks (done/generated ratio, plus a per-day dot row), session-shape adherence is a plain usage count off `study_sessions.ritualId`. Per the same anti-gamification stance as meta-skills above, the vocabulary is deliberately flat — **"skipped," never "missed"**, "N of M done in the last 4 weeks" rather than a streak counter, and there is no streak/badge/broken-chain framing anywhere in the adherence display. `groupId` is a schema-only forward-looking hook (always `null` in v1) for a future scope where a group of learners could share a ritual's cadence or shape (e.g. a study group mixing study with a shared activity) — see `data-model.md` for the read rule this implies.

## Exercises: The Auto-Gradeable Complement to Scaffolds (v2.0)

Scaffolds (above) teach — a `worked_example`, a `retrieval_prompt`, a `derivation_walkthrough` — but carry no structured answer to check against. **Exercises** (`exercises` table, seeded per-KC from `courses/<slug>/exercises.json`; see `data-model.md`) are the assess-and-check counterpart: `mcq` items grade against a stored `correct_index`, `numeric` items grade against a tolerance-checked target value, and `worked` items are self-checkable study material (a full solution, no submission). `POST /exercises/:id/attempt` grades a submission server-side and appends a dual-role `retrieval_practice` event on the exercise's KC, `payload.channel: "exercise"`.

This gives `retrieval_practice` two distinct channels feeding the same event type and the same mastery fold: `channel: "quick_quiz"` (an AI-generated or, as of v2.0, seeded-bank question answered through the quick-quiz flow) and `channel: "exercise"` (a direct per-KC exercise attempt from the KC detail page). Both are dual-role (`is_instructional: true, is_assessment: true`, per `EVENT_ROLE_FLAGS`) and fold into mastery identically — the channel tag is provenance for analytics/debugging, not a different scoring path. `POST /flows/quick_quiz` prefers the seeded `mcq` bank over an OpenRouter call whenever a picked KC has one, which means assessment now works end-to-end with no `OPENROUTER_API_KEY` configured, for any KC the seeded bank covers.

## TODO

- **AFM (Additive Factors Model)**: Extend the fold to estimate per-KC learning rate and per-instructional-method effectiveness.
- **BKT (Bayesian Knowledge Tracing)**: State-space model of KC mastery with guess/slip parameters; probabilistic inference.
- **Spaced-repetition scheduler**: Recommend review timing based on forgetting curve and mastery uncertainty.
- ~~**Prerequisite modeling**: Use knowledge-map edges to adjust mastery inference (e.g., struggling with Bernoulli may indicate weak Pressure KC).~~ **Partially done, v1.9**: the ZPD frontier section above uses `kc_edges` to gate *what's worth learning next*, not to adjust the mastery *number* itself — `foldMastery` still reads only a KC's own events, unchanged. A prereq-aware mastery adjustment (e.g. discounting a KC's score while its prerequisites are shaky) remains unbuilt.
