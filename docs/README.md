# studyus Documentation Map

This directory holds product and architecture documentation for studyus, a KLI-grounded study platform for university students. Docs follow a **fractal structure**: high-level conceptual docs first, each ending with a `## TODO` section that defers lower-level details to later iterations without breaking abstraction.

## Structure

### Product (`/product/`)
- **vision.md** — Target user (McGill ChemEng student), the two halves (admin: calendar/deadlines/grades; learning: feed/courses/tutor), design vibe, webapp first / iPad via frozen API.
- **user-journeys.md** — Onboarding flow, three returning-user entry points (dashboard, browse feed, study), recording outside-app events, future channels.
- **screens.md** — Full screen inventory from the build plan with purpose and key components per route.
- **student-lifecycle.md** — Mermaid diagrams of the student's full lifecycle in studyus: onboarding, the daily before/in/after-class rhythm, weekly planning, pre-exam practice, post-grade reflection, and the long-run mastery loop, each annotated with the studyus surface that serves it.

### Architecture (`/architecture/`)
- **overview.md** — Stack (Astro 7.2 + Svelte 5, @astrojs/cloudflare 14 on Workers, D1 + Drizzle, R2, OpenRouter), headless service principle, repo layout.
- **data-model.md** — Every table and relationship (column-by-column, full FK/ON DELETE and index inventory); LearnerProfile as aggregation service, not table; knowledge map stubbed.
- **events-and-mastery.md** — **THE KLI DOC.** Ontology (KCs cause performance; Instructional/Learning/Assessment Events; dual-role flags), KC taxonomy (fact/association/concept/rule/principle), learning processes, instruction matching (asymmetry hypothesis), CMU DataShop convention as conceptual background, and the shipped mastery fold (`src/lib/services/mastery.ts`) as actually implemented.
- **tutor.md** — AI tutor architecture: mode selection by KC type, OpenRouter SSE proxy, interactive-model spec, context assembly, session event hookup.
- **cloudflare.md** — Adapter v14 specifics (Workers not Pages, wrangler.jsonc, workerd dev, D1 batch atomicity, local .wrangler/state).
- **observability.md** — Local-only Cloudflare native tracing (`wrangler.jsonc`'s `observability.traces` flag, the `cdn-cgi/explorer` UI, the `withSpan` helper) — dev-loop diagnostic only, no persistence or export path.
- **agentic-channels.md** — Flue pattern (separate Worker + Durable Objects, service binding, tools wrapping services, quick_quiz as v1 pattern-setter, channels→agent→tools→services→events), explicitly post-v1 experimental.

### Design (`/design/`)
- **charter.md** — Binding theme-design contract from the compass/campus/focus design debate: shared structure is mandatory and theme-neutral, per-theme work is token-values only (fonts/colors/spacing/motion/radius/shadow).
- **compass.md**, **focus.md**, **campus.md** — Per-theme voice/type/color-story/density/motion rationale and do/don't lists for each of the three shipped themes.
- **planner-ux.md** — The planner week-grid UX spec (hour gutter, event-block design, navigation, sidebar/agenda pairing, interaction, visual hierarchy) — annotated inline where a spec'd feature (mini-month jump, rail click-to-schedule) hasn't shipped yet.
- **mobile-shell.md** — The mobile shell contract below the `@media (max-width: 767px)` breakpoint: bottom tab bar, header-popovers-as-sheets, per-page mobile compositions.

### API & Decisions
- **api.md** — DRAFT of full `/api/v1` endpoint contract (method, path, purpose, request/response shapes). Frozen at end of M1. Session auth via HttpOnly cookie.
- **decisions/** — ADRs transcribed from locked decisions:
  - ADR-001-astro-ssr-on-cloudflare.md
  - ADR-002-svelte.md
  - ADR-003-d1-drizzle.md
  - ADR-004-event-sourced-mastery.md
  - ADR-005-hand-rolled-sessions.md
  - ADR-006-r2-uploads.md

### Roadmap
- **todo.md** — Deferred: multi-user signup, argon2, real social feed, global knowledge map, iPad client, Flue agents + channels, spaced-repetition scheduler, AFM/BKT mastery.

## Reading Guide

**For product**: Start with vision → user-journeys → screens. Each screen links to its data model dependencies.

**For architecture**: Start with overview → data-model. Then dive deep:
- Understanding mastery? Read events-and-mastery.
- Building the tutor? Read tutor.
- Deploying or adding a new binding? Read cloudflare.
- Planning agentic features? Read agentic-channels.

**For design**: Start with charter (the binding cross-theme contract), then the specific theme doc (compass/focus/campus) you're touching. Building planner UI? Read planner-ux. Touching anything below the mobile breakpoint? Read mobile-shell.

**For API contracts**: api.md is frozen after M1 and drives the iPad client build.

**For locked decisions**: decisions/ explain the why and consequences of each major choice.

## TODO

- Knowledge map entity model (stub in data-model, later expand in agentic-channels when Flue is real).
- Multi-user signup flow detail (onboarding, email verification).
- Full integration narrative (how the pieces talk to each other end-to-end).
- Operational playbook (deployment, rollback, monitoring hints).
