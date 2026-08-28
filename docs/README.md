# studyus Documentation Map

This directory holds product and architecture documentation for studyus, a KLI-grounded study platform for university students. Docs follow a **fractal structure**: high-level conceptual docs first, each ending with a `## TODO` section that defers lower-level details to later iterations without breaking abstraction.

## Structure

### Product (`/product/`)
- **vision.md** — Target user (McGill ChemEng student), the two halves (admin: calendar/deadlines/grades; learning: feed/courses/tutor), design vibe, webapp first / iPad via frozen API.
- **learning-science.md** — Public-claim source of truth: principle-by-principle implementation status, concrete code/surface checklist, evidence links, and explicit boundaries for features that are partial or student-controlled.
- **user-journeys.md** — Current public-trial and Clerk entry flow, returning-user entry points, recording outside-app events, and future channels.
- **onboarding.md** — Implemented public trial and first-run contract: local shadow state, university + semester, at least one course/KC, safe auth import, hard completion invariant, and explicit ingestion follow-ups.
- **screens.md** — Full screen inventory from the build plan with purpose and key components per route.
- **student-lifecycle.md** — Mermaid diagrams of the student's full lifecycle in studyus: onboarding, the daily before/in/after-class rhythm, weekly planning, pre-exam practice, post-grade reflection, and the long-run mastery loop, each annotated with the studyus surface that serves it.
- **annotations.md** — Convention for the **temporary** in-app docs annotation overlay: field vocabulary (purpose/affordances/actions/feedback), the binding rule that keeps `src/lib/docs-overlay/annotations.ts` in sync with `screens.md`, anchoring conventions, and how to retire the whole layer.

### Architecture (`/architecture/`)
- **overview.md** — Stack (Astro 7.2 + Svelte 5, @astrojs/cloudflare 14 on Workers, D1 + Drizzle, R2, OpenRouter), headless service principle, repo layout.
- **authentication.md** — Current Clerk authentication authority, immutable local learner-id bridge, new-user provisioning, and legacy-account migration runbook.
- **data-model.md** — Every table and relationship (column-by-column, full FK/ON DELETE and index inventory); learner profile as aggregation service, misconception lifecycle, and the computed-on-read frontier/knowledge-map summary.
- **events-and-mastery.md** — **THE KLI DOC.** Ontology (KCs cause performance; Instructional/Learning/Assessment Events; dual-role flags), KC taxonomy (fact/association/concept/rule/principle), learning processes, instruction matching (asymmetry hypothesis), CMU DataShop convention as conceptual background, and the shipped mastery fold (`src/lib/services/mastery.ts`) as actually implemented.
- **event-catalog.md** — Operational companion to the KLI doc: the canonical event catalog (every emitted domain event with emitter/payload/fold-read keys, plus the B1-retired vocabulary), expected lifecycles and orderings, idempotency guarantees, known defects, and the deliberate PostHog behavioral stream (45 of 46 approved emitter paths implemented and operationally enabled; `resource_saved` is the sole implement-or-prune decision).
- **tutor.md** — AI tutor architecture: mode selection by KC type, OpenRouter SSE proxy, interactive-model spec, context assembly, session event hookup.
- **cloudflare.md** — Adapter v14 specifics (Workers not Pages, the custom Worker entrypoint, D1/R2/DO bindings, request `waitUntil`, awaited DO alarms, cron environments, workerd dev, deployment, and local `.wrangler/state/v3`).
- **observability.md** — Local-only Cloudflare native tracing (`wrangler.jsonc`'s `observability.traces` flag, the `cdn-cgi/explorer` UI, the `withSpan` helper) — dev-loop diagnostic only, no persistence or export path.
- **agentic-channels.md** — Current per-learner Durable Object runtime plus the historical Flue/channel design retained as future-adapter context.
- **calendar-integrations.md** — Canonical calendar model, controlled bidirectional sync policy, provider/ICS boundaries, outbox guarantees, timezones, and OAuth scope setup.

### Design (`/design/`)
- **charter.md** — Binding theme-design contract from the compass/campus/focus design debate: shared structure is mandatory and theme-neutral, per-theme work is token-values only (fonts/colors/spacing/motion/radius/shadow).
- **compass.md**, **focus.md**, **campus.md** — Per-theme voice/type/color-story/density/motion rationale and do/don't lists for each of the three shipped themes.
- **planner-ux.md** — The planner week-grid UX spec (hour gutter, event-block design, navigation, sidebar/agenda pairing, interaction, visual hierarchy) — annotated inline where a spec'd feature (mini-month jump, rail click-to-schedule) hasn't shipped yet.
- **mobile-shell.md** — The mobile shell contract below the `@media (max-width: 767px)` breakpoint: bottom tab bar, header-popovers-as-sheets, per-page mobile compositions.

### API & Decisions
- **api.md** — Versioned `/api/v1` endpoint contract (method, path, purpose, request/response shapes). The original M1 data shapes remain compatibility-oriented; authentication now comes from Clerk and post-M1 additions are recorded in-place.
- **decisions/** — ADRs transcribed from locked decisions:
  - ADR-001-astro-ssr-on-cloudflare.md
  - ADR-002-svelte.md
  - ADR-003-d1-drizzle.md
  - ADR-004-event-sourced-mastery.md
  - ADR-005-hand-rolled-sessions.md *(superseded by Clerk; retained as the historical decision and migration source)*
  - ADR-006-r2-uploads.md

### Roadmap
- **todo.md** — Current implementation gaps and intentional deferrals. Durable course ingestion/map maintenance, external channels, a real social feed, native iPad, advanced mastery inference, and the optional Learning to Learn course remain later work.

## Reading Guide

**For product**: Start with vision → user-journeys → onboarding → screens. `user-journeys.md` describes what a learner can do now; `onboarding.md` separates shipped first-run behavior from its follow-ups. Each screen links to its data model dependencies. Touching the in-app docs overlay or its registry? Read annotations.md first — `npm run check:annotations` enforces it staying in sync with screens.md.

**For architecture**: Start with overview → data-model. Then dive deep:
- Understanding mastery? Read events-and-mastery.
- Instrumenting or analyzing domain/behavioral events? Read event-catalog.
- Building the tutor? Read tutor.
- Deploying or adding a new binding? Read cloudflare.
- Planning agentic features? Read agentic-channels.
- Changing calendar sync? Read calendar-integrations.

**For design**: Start with charter (the binding cross-theme contract), then the specific theme doc (compass/focus/campus) you're touching. Building planner UI? Read planner-ux. Touching anything below the mobile breakpoint? Read mobile-shell.

**For API contracts**: api.md documents the current v1 compatibility baseline and drives the iPad client build. Native clients still need a Clerk-compatible authentication design.

**For decisions**: decisions/ explain the why and consequences of each major choice. An ADR marked superseded remains historical context, not the current implementation contract.

## TODO

- Deepen durable ingestion and course-map maintenance in `product/onboarding.md`.
- Finish the global knowledge-map catalog/closure work beyond the shipped one-hop frontier.
- Full integration narrative (how the pieces talk to each other end-to-end).
- Operational playbook (deployment, rollback, monitoring hints).
