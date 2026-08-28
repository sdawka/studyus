# AI Tutor Subsystems — Design (Approach A)

**Date**: 2026-08-23 · **Status**: implemented foundation — learner lifecycle,
four headless domain engines, Clerk local-ID bridge, and native per-learner
Durable Object runtime landed in the single Astro Worker. Web is the only
public channel in this pass; Flue remains a future adapter.
**Chart**: `docs/index.html` — the canonical, self-contained architecture chart (open in any browser; embedded fonts, no network needed)
**Sources**: `docs/architecture/tutor.md`, `docs/architecture/events-and-mastery.md`, `docs/architecture/agentic-channels.md`, `docs/architecture/data-model.md`, `docs/todo.md`

## Decision

**Deterministic learner model + four pedagogy engines + one agent per learner.** The learner model and knowledge map are libraries/services, never agents — folds and frontiers must stay reproducible and cheap. Pedagogy is four headless engines `(userId, input, env) → output`, each multiplexing related capabilities as **modes** rather than one function per pedagogy verb. The Flue layer (target, post-stabilization) runs **one Durable Object per learner**, keyed by user id, which holds session/conversation state, runs the session orchestrator as its brain, and mounts the engines as Zod-validated tools. Channels route by identity to the same agent, so a session started on the web continues on Telegram. The web app calls the services directly until Flue lands.

Rejected: B (everything-an-agent — agentifying deterministic folds adds latency and nondeterminism for zero gain) and C (one global tutor agent — per-learner DOs give isolation and cross-channel continuity that a shared agent can't).

## The four planes

1. **Knowledge plane** (content truth, user-independent): course map (KCs, `kc_edges`, misconception catalog, scaffolds, exercise bank, resources — built), global map (cross-course gating one-hop via frontier — partial).
2. **Learner plane** (per-user, deterministic, event-sourced per ADR-004): event log (sole writer of truth), mastery + freshness fold, traversed map, ZPD frontier, capabilities & rituals — all built; **misconception lifecycle — new** (below). Fronted by the **Learner Profile facade** (extends `getProfile` to one read surface: mastery, freshness, frontier, lifecycle, capabilities).
3. **Pedagogy plane** (headless services now, learner-agent tools later) — the four engines below.
4. **Agent & channel plane** (target): one Durable Object per learner mounting the engines as tools, orchestrator as its brain; channels (web, Telegram/SMS/Discord, email digest) are thin routers mapping channel identity → learner agent. Agent state lives in the DO, never D1.

## Pedagogy engines

| Engine | Status today | Modes / scope |
|---|---|---|
| Session orchestrator — the coach | new | The conductor and the personality. Plans the session arc (check → teach → exercise → diagnose), narrates *why* each step was chosen, prompts planning and reflection, attributes struggle to strategy. Only engine allowed to call peers. |
| Instruction engine | partial | One teaching machine, four modes: `socratic` (the built 6-mode chat tutor incl. absorb), `analogy_example` (analogies/worked examples anchored in the learner's own strong KCs), `spoonfeed` (direct worked instruction when scaffolding should be maximal — an explicit, temporary choice, not a drift), `prereq_gap_filler` (teaches the weak prerequisite that's really behind a struggle at KC X — the open mastery-adjustment TODO as a mode). |
| Exercise engine | partial | One item machine, four purposes: `placement` (calibration walk over the prereq graph on course-add/onboarding, seeds mastery priors **via placement events** — never direct writes), `assessment` (measure chosen KCs, dual-role events), `practice` (difficulty-ramped adaptive items using `exercises.difficulty`, stored but unused today), `diagnostic` (misconception probes from the seeded catalog — the `diagnostic_probe`s are items whose distractors map to misconceptions; writes lifecycle rows). Selects from the bank; generates items where thin (`origin: 'generated'`). Today: quick_quiz + exercise attempts + absorb-mode probing. |
| Assistant-coach admin engine | partial | The logistics half of the coach: freshness-aware review queue (upgrades the 7-day `stale_kc` sweep toward SM-2), multi-day curriculum planning to goal/exam dates, calendar bridging, notifications and reminders, progress digests for every channel. |

## Explicit deferrals and test contract

- **Tool and channel adapters — TODO:** Flue/OpenRouter adapters may select and
  invoke the headless modules, but may not acquire domain business logic. The
  current web-only runtime remains the tenancy/session shell; verified external
  channel identity linking and Telegram/SMS/Discord/email ingress are deferred.
- **Richer instruction and admin behaviours — TODO:** strong-KC analogy
  selection, adaptive scaffold fading, SM-2 review scheduling, curriculum
  planning, calendar bridging, notifications, and cross-channel digest delivery
  remain extensions of their existing engines rather than new agent logic.
- **Global knowledge-map gating — TODO:** cross-course prerequisite gates remain
  partial until the global catalog and one-hop frontier gate are completed.
- **Durable-action contract — required for every implemented learner action:** a
  specialised action must commit its canonical domain fact or state transition before
  reporting success. Observational UI telemetry belongs to the separate behavioral
  stream and must not gate the action. Tests must cover happy paths, boundary/retry/cancellation
  behaviour, invalid and cross-tenant input, and event ordering/idempotency;
  any AI generation or streaming is mocked. Persisting a generated bank item is
  the named content-state exception in invariant 1, so it creates no synthetic
  learner activity event.

## New persisted state: misconception lifecycle

`user_misconceptions` — the one new table. Per (user, misconception): `status ∈ suspected → confirmed → correcting → internalized`, plus `evidence_event_id`s and timestamps. Written by the exercise engine's diagnostic purpose (and by accepting a tutor `correction_proposal`); the existing `user_corrections` ledger becomes transitions within this lifecycle rather than a parallel store. Rendered on the traversed map as per-KC pins.

## Two-stream event boundary (supersedes the original widening proposal)

The original version of this design proposed making D1 `events` a complete activity
stream. B1 (2026-08-28) rejected that widening in favor of a simpler boundary:
durable learner-domain facts stay in D1; observational product usage goes to the
separate behavioral stream. `placement_probe` and `diagnostic_probe` remain assessment
evidence. `correction_accepted` and `course_added` remain durable context facts. The 11
unwired placeholders were pruned, and recommendation follow/ignore moved to the
behavioral vocabulary.

**Fold guard (required)**: idle-decay's `lastEventAt` reads role-flagged evidence only;
a durable context fact must never reset a KC's freshness. The canonical operational
taxonomy lives in `docs/architecture/event-catalog.md`.

## Coaching stance

The orchestrator — and by extension every surface it conducts — carries an assistant-coach personality: **metacognition-enhancing** (narrate why a step was chosen, prompt planning before and reflection after, surface the learner's own trajectory rather than hiding the model) and **anti-learned-helplessness** (attribute struggle to strategy and practice, never ability; every dead end ends with one concrete next step; scaffolds fade rather than take over). This extends the existing KLI informational-tone rule and the rituals feature's no-guilt state design. Recorded durably in `docs/architecture/tutor.md` ("Coaching Stance").

## Invariants

1. **Events are the only writer** — no engine touches mastery columns; the fold re-derives. Named exceptions: lifecycle rows and generated bank items (exercise engine).
2. **Derived beats persisted** — frontier/freshness/overlays computed at read; only the event log and lifecycle earn persistence.
3. **State math is never agentic** — LLMs live in plane 3+.
4. **One read surface** — engines read the profile facade, not raw tables.
5. **The agent is a shell** — every engine ships as a service first; the per-learner agent adds session state and channel reach, never business logic.
6. **Star, not web** — only the orchestrator composes engines; peer-to-peer calls forbidden.
7. **Modes before functions** — a new capability joins an existing engine as a mode when it shares that engine's reads and writes; it becomes a new engine only when its I/O contract genuinely differs.
8. **Coach, don't rescue** — every surface narrates why, prompts reflection, attributes struggle to strategy; no guilt framing, ever.
9. **Evidence moves mastery, behavior never enters the log** — only role-flagged domain evidence reaches the fold; durable context facts are excluded and UI telemetry uses the behavioral stream.

## Suggested build order (to be planned via writing-plans)

1. Learner Profile facade + misconception lifecycle table + two-stream event boundary and fold guard — landed foundation that unblocks everything.
2. Exercise engine: practice-mode difficulty selection first (no LLM needed) → assessment unification over quick_quiz → diagnostic purpose (split out of absorb) → placement mode.
3. Admin engine: review-queue upgrade → digests/notifications → curriculum planning.
4. Instruction engine: reframe the built chat tutor as `socratic` mode → `analogy_example` + `prereq_gap_filler` → `spoonfeed`.
5. Session orchestrator with the coaching stance (needs the engines to exist).
6. Flue plane (per-learner agent), when the API stabilizes.
