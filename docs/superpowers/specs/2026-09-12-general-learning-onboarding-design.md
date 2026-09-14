# General Learning Onboarding and Course Domain Design

## Goal

Make studyus a general-purpose learning app whose courses may represent any learnable topic. Every new learner receives an editable, learner-owned “Learning How to Learn” mini-course, while onboarding optionally gathers context or creates another course instead of requiring university metadata.

## Product contract

- A course is any bounded learning goal, not necessarily an academic class.
- Every new local learner is atomically enrolled in the current “Learning How to Learn” template.
- Enrollment is a deep copy. The learner owns and may edit or archive the course and all descendants.
- Enrolled copies never synchronize with the source. Template revisions affect only later accounts.
- There are no existing users to backfill.
- Onboarding is skippable. Skipping marks setup complete and opens the default course.
- Institution, program, term, credits, instructor, and assessments remain optional metadata; none gates entry.
- Manual authoring and optional future generation produce the same validated course draft and use the same commit service.

## Learning model

The stable flow is:

`Intent → KC graph → process hypotheses → Experiences → Evidence → KCState → next Experience`

The domain keeps four boundaries:

1. A `KnowledgeComponent` describes what may change in the learner.
2. An `Experience` describes what the learner encounters or does and which process it intends to evoke.
3. `Evidence` records an observation produced by an experience or external performance.
4. `KCState` is inferred from evidence and is never an observed fact.

Modules and lessons are ordered learner-facing views over the KC–Experience graph. They may be rearranged without changing KC identity, historical evidence, or inferred state.

## Course aggregate and storage

`courses` remains the learner-owned root. Existing academic fields become optional. Add general learning fields for topic, level, optional project and constraints, plus passive source-template key and version provenance.

Add first-class relational objects:

- `course_outcomes` and `outcome_kcs`;
- `kc_examples` and `example_kcs`;
- `experiences` and `experience_kcs`;
- `experience_misconceptions` for diagnostic contracts;
- `course_references` with link tables for KCs, examples, experiences, and misconceptions.

Structured content, scoring, project constraints, and mastery rules use strict versioned Zod schemas persisted as JSON. Ownership, identity, ordering, prerequisites, and many-to-many relationships remain relational.

### Knowledge components

Canonical KC types become:

- `constant_constant`: stable condition to stable response, usually memory and fluency;
- `variable_constant`: varying cases to stable category or response, usually induction and refinement;
- `variable_variable`: varying conditions to varying responses, usually induction, refinement, and sense-making.

Bundled content maps the old taxonomy deterministically: fact/association to `constant_constant`, concept to `variable_constant`, and rule/principle to `variable_variable`. Each KC also has a rationale level and mastery rule. Every active KC requires an example and an evidence-producing experience before course activation.

### Experiences

`experiences` is the common parent for existing scaffold and exercise specializations:

- a scaffold is instructional content with a support level;
- an exercise is practice, assessment, or mixed content with response and scoring contracts;
- a project may target several KCs and produce rubric-scored evidence.

Existing scaffold and exercise tables remain specialized payload tables linked one-to-one to an experience during migration. Their APIs may remain, but creation and cloning go through the experience aggregate.

Every experience names one or more intended processes: `memory_fluency`, `induction_refinement`, or `understanding_sensemaking`.

### Evidence and KC state

The event stream remains the durable observation log. Evidence-producing events gain an optional experience link and support multiple KC targets; context-only events stay outside inference.

`KCState` is a recomputable read model with mastery estimate, confidence, evidence IDs, and last update time. KC rows may cache these values, but only the sanctioned event/evidence service updates them atomically with an observation.

Mastery rules may require a threshold, minimum evidence, transfer, and retention. The implementation remains a transparent deterministic heuristic, not a psychometric probability. `LearningInference` is a deferred derived audit view.

## Authoring boundary

Introduce strict `CourseDraftV2` schemas for course spec, outcomes, KCs, examples, misconceptions, experiences, and references. Manual onboarding, post-onboarding authoring, reviewed templates, local extraction, and optional future generation all produce this contract.

One validator enforces invariants and one transactional service persists a valid draft. Generated output never writes directly to domain tables or learner state. Generation, billing, and premium entitlements are deferred; this delivery establishes the adapter seam and complete manual path without a model dependency.

## Account bootstrap

Local Clerk identity resolution invokes an idempotent bootstrap service. For a new learner, one D1 transaction:

1. creates the local user;
2. loads and validates the current bundled first-party course;
3. deep-copies its course, outcomes, graph, examples, misconceptions, experiences, specialized content, references, and links with fresh learner-owned IDs;
4. records passive template provenance.

The user and usable course must not become observably separated. A retry resolves enrollment by a stable bootstrap key and returns the same course. Direct database fixtures remain explicit and are not silently bootstrapped.

## Onboarding journey

Onboarding becomes optional personalization:

1. Explain that “Learning How to Learn” is already available.
2. Optionally collect topic, level, desired outcomes, interests, or goals.
3. Optionally create another course manually, from a template, or from local extraction.
4. Finish or Skip: save supplied preferences, stamp `onboarded_at`, and open the new or default course.

University, program, semester, schedule, and formal assessment fields move behind optional academic context. Public trial copy stops treating university life as universal.

Middleware continues to require `onboarded_at`; the usable course is guaranteed by provisioning. Archiving the default course later does not reopen onboarding. Normal course empty states offer course creation.

## “Learning How to Learn” curriculum

Visible module titles are questions. Technical terms live inside experiences.

### 1. How do you know you’ve learned something?

Evidence versus confidence, performance versus durable learning, calibration, retention, and transfer. Learners predict an answer, complete a check, compare confidence with evidence, and revisit it later.

### 2. How do you access what you’ve learned?

Retrieval, cues, spacing, interleaving, and fluency. Experiences contrast rereading with retrieval, schedule delayed recall, and vary nearby concepts.

### 3. What does learning feel like?

Effort, confusion, false fluency, chunking, understanding, and productive difficulty. Experiences contrast easy recognition with effortful recall and form a meaningful chunk.

### 4. What helps you learn best?

Examples/nonexamples, scaffolding/fading, worked examples, self-explanation, practice, feedback, and error analysis. Support fades and misconceptions receive diagnostic evidence.

### 5. How can you keep getting better at learning?

Planning, reflection, strategy selection, evidence review, retention, and transfer. Learners build a small plan, choose a next experience from evidence, and reflect on strategy rather than ability.

Each short module includes explanation, examples or contrasts, practice, an evidence-producing check, and a later retention or transfer revisit. The course teaches the methods by using them.

## Adaptation

The deterministic next-experience selector:

- respects prerequisites;
- prefers a ready KC for an unmet outcome;
- matches experience/process to KC type and evidence;
- spaces repeated checks;
- raises difficulty or fades support after success;
- chooses contrast, prerequisite repair, or more support after weak or misconception-linked evidence;
- reserves transfer and retention checks for later encounters;
- returns reasons for tests and learner-facing explanation.

BKT, IRT, and model-selected pedagogy remain deferred.

## Validation and errors

Activation rejects drafts when an outcome has no KC; an active KC lacks an example, mastery rule, or evidence-producing experience; an experience lacks a target or intended process; a referenced object is missing; prerequisites cycle; evidence targets an unavailable KC; or structured content violates its schema version.

Bootstrap fails closed if learner and course cannot commit together. Onboarding saves are idempotent, server-validated, and never import simulated evidence.

## Compatibility

- Add an additive D1 migration and update Drizzle/content schemas together.
- Convert bundled catalog content at load/seed time with validation tests.
- Preserve course URLs, learner ownership, the event stream, and atomic mastery recomputation.
- The detached first-party course never participates in template synchronization; current reviewed academic templates may retain it temporarily.
- Update existing product, architecture, API, journey, and learning-science docs where their university-only or future-course claims become false. Do not add parallel summaries.

## Acceptance criteria

Automated evidence must show:

- first provisioning creates exactly one user and one complete default course atomically;
- concurrent/repeated provisioning cannot duplicate enrollment;
- later template versions change new enrollments but not existing copies;
- learner edits never mutate the template or another learner’s copy;
- `CourseDraftV2` accepts valid manual/template drafts and rejects each invariant violation;
- onboarding skips without academic context and opens the default course;
- manual onboarding creates any-topic courses without academic metadata;
- evidence updates only targeted learner-owned KC state and context events never do;
- retention and transfer mastery requirements use later evidence;
- selection respects prerequisites, spacing, fading, and misconception repair;
- the bundled course validates all links and contracts;
- mobile/desktop onboarding and course journeys preserve keyboard and reduced-motion behavior.

Verification includes focused tests, the full Vitest suite, type checks, production build, and focused Playwright journeys. The finished branch is pushed as a PR only after local gates pass.

## Deferred

- model-backed generation and premium billing;
- OCR or durable ingestion changes;
- probabilistic mastery models;
- shared course ownership;
- synchronization of detached courses;
- existing-user backfill.
