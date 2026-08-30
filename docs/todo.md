# studyus Roadmap: Deferred Features

**Current-state rule (2026-08-26)**: historical “shipped summary” sections below
explain how the product evolved; they are not the active backlog. The active
priorities are listed here and detailed in their owning docs.

### Active product chain

- [x] **Brand cleanup and rich course onboarding** — reviewed-template APIs,
  editable include/rename/reorder review, prerequisite protection, explicit
  assessment-date decisions, template provenance, and atomic cloning of the
  full authored learning content are implemented.
- [x] **Post-onboarding course-map maintenance** — atomic branch/KC
  add/edit/reorder/archive/restore, global prerequisite validation, and
  reviewed-template refresh/reconciliation are implemented on Concepts.
- [x] **Global Next Move** — the dashboard now ranks learning actions across
  active courses from assessment urgency, prerequisite leverage, mastery need,
  recency, and an explicit 15/25/50-minute budget. It launches a targeted
  Understand session or exact-KC Quick Quiz and records follow/ignore context.
- [x] **AI feature boundary** — one server-authoritative capability gate now
  separates OpenRouter-backed tutoring/question generation from non-AI study
  tools; seeded quizzes remain usable without AI and staging defaults off.
- [ ] **Replanning loop** — recompute recommendations when classes are missed,
  dates or weekly capacity change, grades arrive, or plans are disrupted. Needs a
  D1 schedule-change log: session reschedules currently overwrite `scheduledAt`
  with no history (see `docs/architecture/event-catalog.md` D8/D10).
- [ ] **Durable material ingestion** — retain validated syllabus/schedule files
  in R2 with extraction provenance, retry state, and asynchronous processing.
- [ ] **Better extraction** — structured optional AI extraction, confidence and
  source spans, OCR, and prompt-injection defenses while keeping manual/local
  fallback paths.
- [ ] **First-use orientation** — contextual guidance, optional placement,
  resumable server-owned drafts, and schedule-driven class/task generation.
- [ ] **Catalog expansion** — normalized institutions/programs and additional
  reviewed course templates when coverage warrants it.

### Other active priorities

1. **Deepen course ingestion** — rich reviewed-course onboarding and reusable
   post-onboarding map maintenance are implemented. Next add durable R2
   ingestion. Full status:
   `docs/product/onboarding.md`.
2. **Close the behavioral analytics catalog** — the D1 event vocabulary has been
   narrowed back to durable learner-domain facts, and deliberate PostHog emitter paths
   are implemented for 45 of 46 approved behavioral names and operationally enabled
   behind the token, DNT, opt-out, and developer-exclusion gates. The only vocabulary
   decision left is to implement a real save-an-existing-resource-to-course action for
   `resource_saved`, or prune that name. Reporting conventions and dashboards remain
   separate follow-up work; see `docs/architecture/event-catalog.md`.
3. **Expose the coach/orchestrator** — four domain engines and the per-learner
   Durable Object foundation exist. The web tutor now projects authoritative
   DO conversation/session/alarm state into Nanostores and reconciles streams,
   closes, reloads, and exact history resumes; learner-facing orchestration
   beyond tutor conversations and external channel adapters remain pending.
4. **Content authoring** — learner map maintenance is shipped; full rich
   scaffold, misconception, exercise, and resource authoring remains deferred.

Clerk multi-user authentication, the ZPD frontier, rituals/capabilities, the
exercise bank, and the native per-learner Durable Object runtime are implemented
and must not be described as wholly deferred.

**M0–M5 Status (2026-08-11)**: Core v1 complete. Frozen API contract (docs/api.md), mastery fold, core UI, AI tutor, quick_quiz flows shipped.

**v1.1 Status (2026-08-12)**: Rename (studybuddy → studyus, incl. session cookie name) + full UI overhaul shipped. See "v1.1 Shipped Summary" below. Features under "Deferred Features (Post-v1)" remain deferred; a few new deferrals were added by v1.1's own scoping decisions (called out inline).

**v1.2 Status (2026-08-12)**: Unified calendar data plane, design-token/popover foundation, three theme design passes (fonts + colors + spacing + motion, structure unchanged), planner overhaul (week time-grid default, EventPopover, PlannerRail, inline session create, deep links), dashboard recomposition (CourseCards, collapsible WeekView), and a Pinterest-style feed masonry shipped. See "v1.2 Shipped Summary" below. Note: the components named in "v1.1 Shipped Summary" below (WeekStrip, GradeSnapshot, CourseMiniGrid) were deleted as part of v1.2's dashboard recomposition — that section is left as a historical record of what v1.1 shipped, not a description of current code.

**v1.4 Status (2026-08-13)**: Task-centric platform. Real task rows for every checkable thing (`type` enum, `description`, one level of subtasks, origin FKs) replace the old title/due-date/done-only shape; six independently-toggleable sweep generators (`services/taskSweep.ts`) populate `tasks.source = 'system'` — the exact gap this doc flagged as deferred under "v1.1-Specific Deferrals" below, now resolved; two-way sync between `attend_class` tasks and class-session attendance, and between `grade_entry` tasks and grade entry; KC↔assessment linking gets a UI (`assessment_kcs`, via AssessmentsCard's "Concepts covered" picker); dashboard leads with `TodayTasks` (checkable hero) ahead of slimmed `CourseCards`; `/tasks` rebuilt as a full-page route-modal with per-course cards and subtasks; a new course-home `TasksCard` and a `/settings` "Automatic tasks" panel. Full contract in `docs/api.md`'s "v1.4 Additions" section.

**v1.5 Status (2026-08-14)**: Mobile layouts + PWA shell. Adaptive shell below `@media (max-width: 767px)` (`MOBILE_QUERY` in `src/lib/stores/viewport.ts`): bottom tab bar (Home/Tasks/Record-FAB/Planner/Courses) replaces the sidebar, header popovers become bottom sheets, `/planner` and `/tasks` become full tab pages instead of centered modals; every page got a bespoke mobile composition (dashboard leads with tasks, planner defaults to Agenda with a container-measured 1/3/7-day WeekGrid, touch-sized task rows, course StandingTab reordered around the "hallway jobs"); a basic PWA shell (manifest, icons, safe-area insets, no service worker). Full contract in `docs/design/mobile-shell.md`. This wave also fixed the app-wide ~400px overflow flagged below and a latent **desktop** bug: `main`'s `container-type: inline-size` was trapping the planner/tasks route-modal layers' `position: fixed` descendants (scrim, EventPopover, CreateSessionPopover, WeekGrid's hover card) inside `main`'s box instead of the viewport — an overlay slot (`AppShell.astro`, direct `<body>` child after `.shell`) fixes both.

### Code-health backlog (2026-08-29 review)

Findings from a modularity/copy review, each verified against the tree at
`aac5451`. Shipped in #19: student-facing "KC"/"knowledge component" wording
(17 acronym + 9 spelled-out strings) and the calendar client/server naming
collision. Shipped on `cleanup/api-error-wrapper-and-dedup`: the
`withServiceErrors` rollout and three helper consolidations. The rest:

- [ ] **`services/taskSweep.ts` is a god module** — 563 lines, one export
  (`sweepTasks`), ten internal collectors. Split each task family
  (`attend_class`, `prep_class`, `review_after_class`, `practice_kc`,
  `stale_kc`, `grade_entry`, `ritual_occurrence`) into its own module and leave
  `sweepTasks` as the orchestrator.
- [x] **`withServiceErrors` adoption** — done: 13 handlers across 11 route files
  (4 had hand-rolled try/catch, the rest ran unguarded awaits).
  `calendar/connections/index.ts` holds two of the 13, GET and POST.
  Six handlers stay unwrapped on purpose, and the count is worth stating
  precisely because "N of 66 routes comply" invites cargo-cult wrapping:
  - `capabilities/index.ts`, `auth/login.ts`, `auth/logout.ts` and
    `user/index.ts`'s GET have zero `await` and return static or
    already-resolved data — nothing can throw. (`auth/login.ts` is a 410
    retirement stub.) An earlier note here claimed all 15 non-adopters
    hand-rolled error shaping "including the auth routes where it matters
    most"; that was wrong.
  - `calendar/feed/[token].ics.ts` serves `text/calendar` and
    `tutor/conversations/[id]/messages.ts` streams SSE. Both would be handed a
    JSON envelope their clients cannot parse; the SSE route already calls
    `serviceErrorResponse` itself.
  - Note `user/index.ts` is a *mixed* file — GET bare, PATCH wrapped. Auditing
    adoption by filename (`grep -l withServiceErrors`) cannot see this; count
    exported handlers, not files.
- [x] **`apiErrors.ts` error tiering** — decided. The criterion is the *code a
  type emits*, not how often it is thrown (three centralized types —
  `ForbiddenError`, `AiFeatureUnavailableError`, `NotManualEventError` — are
  thrown exactly once each, so frequency was never the rule). A type that
  resolves to a generic envelope code belongs in `serviceErrorResponse`; one
  that emits a domain-specific code documented in `docs/api.md` stays with its
  route. Only `ExerciseAttemptMismatchError` met the first test — it spent a
  try/catch producing `invalid_input`/400, identical to the ZodError branch —
  and is now centralized. `QuizGenerationError` (`quiz_generation_failed`/502),
  `QuizNotGradableError` (`quiz_not_gradable`/400),
  `ProviderTokenUnavailableError` (`calendar_permission_required`/409) and
  calendar's `calendar_connection_failed`/502 stay route-local by that rule.
  Note the class was moved to `services/util.ts`, not imported from
  `lib/flows/`: `apiErrors.ts` is on every route's import path, so pulling a
  flow into it would drag the exercise bank into every route bundle. Error-class
  placement here is a bundling decision as much as a taxonomy one.
- [ ] **Shared helpers exist but get reimplemented** — the recurring theme, and
  a discoverability problem rather than a missing-abstraction one:
  - [x] `chunk<T>()` — consolidated into `services/util.ts`.
  - [x] `exerciseDetails()` — consolidated into `content/exercises.ts`.
  - [x] `courseFor()`/`hueForItem()` — `courseForItem`/`hueForItem` added to the
    existing `lib/courseHue.ts`; five local copies deleted.
  - [x] The `db.batch(statements as [BatchItem<'sqlite'>, ...])` cast —
    `courseMap.ts`'s local `runBatch` hoisted to `services/util.ts`; all five
    sites now call it and the cast exists once. The wrapper's empty check is a
    no-op at the four adopting sites, which each already guarantee a non-empty
    array, so this was a pure dedup.
  - [ ] 21 raw `.toLocaleDateString()` call sites against a `lib/plannerDates.ts`
    that already exports 25 date helpers. Left for its own pass: each site needs
    a judgment call about which existing format variant it should use, so it is
    not a mechanical substitution.
- [ ] **Reorganize the calendar service layer** — 8 `services/calendar*.ts`
  files, 1644 lines, no clear seams, sitting alongside the separate
  `lib/calendar/` tree. Deliberately out of scope for the naming fix; needs its
  own pass.
- [ ] **Decompose two components** — `planner/EventPopover.svelte:124-350` (five
  handlers each re-rolling try/catch + toast + fetch) and
  `standing/AssessmentsCard.svelte:41-123` (21 `$state` vars spanning grading,
  add-form, edit-form, and KC fetch). Extract to `.svelte.ts` rune modules.
- [ ] **Remaining copy fixes** — `corrections.astro:31` opens with pedagogical
  framing ("Beliefs the tutor flagged... until you mark them internalized");
  `StudyFlow.svelte:532` shows "Mastery 40% → 55%" with no referent;
  `dashboard.astro:154`/`:156` repeat "Add your first course" as both heading
  and button; sign-up CTA is labelled "Create a free account" in
  `HeroRD.astro:95` but "Create an account" in `FinalCta.astro:66`.
  Not a copy fix: the `/tasks` "Ta-Da" tab is deliberate product vocabulary,
  named in `docs/api.md` (the "Ta-Da" tab's data source) and in
  `docs/product/student-lifecycle.md`'s prose and flowchart. A review pass
  flagged it as unclear; it was checked against the docs and kept.


Each deferred feature is prioritized and scoped to avoid scope creep during post-v1 development.

---

## v1.2 Shipped Summary

- **Calendar data plane**: unified `CalendarItem` type (`src/lib/types/calendar.ts`) across all 4 item kinds (`assessment_due`, `task_due`, `study_session`, `event_logged`) with `end_date`/`all_day`/`href`, produced solely by `getCalendar` (`src/lib/services/calendar.ts`). Migration `0002_clean_sandman.sql` adds `study_sessions.scheduled_at` so planner-created sessions have a time. Demo seed data (`scripts/seed.ts`) now includes assessments+grades, tasks, events, and study sessions for the current term (`Winter 2025`), idempotent and deterministic, so the planner/dashboard render something realistic out of the box.
- **Design-token / UI foundation**: `base.css` popover primitives (`.popover`/`.panel-head`/`.footer-link`/`.icon-btn`) shared by every popup in the app; new tokens `--accent-contrast`, `--space-1..6`, `--motion-fast/-base`, `--weight-med/-semi/-bold`, `--tracking-caps`, `--pop-w-sm/-md/-lg`; global `--content-max` centered main column; **default scheme is now `light`** (`resolveSettings` in `src/lib/services/user.ts`), was `system`.
- **Three theme design passes**: compass (Figtree display / flat cards / airy spacing), focus (Space Grotesk + Inter / indigo hue 264 / dense), campus (Fraunces + Nunito / warm paper / brick accent) — self-hosted `@fontsource` variable fonts per theme in `src/styles/fonts/{compass,focus,campus}.css`. Themes vary only fonts/colors/spacing/motion; component structure is identical across all three (see `docs/architecture/overview.md`'s Design Tokens section). Per-theme rationale docs at `docs/design/{compass,focus,campus}.md`.
- **Course-hue fix**: hue derivation (`--course`/`--course-ink`/`--course-soft`) moved from `:root` to the universal selector `*` in `tokens.css`, so a per-element `--course-h` override actually takes effect.
- **Planner**: week time-grid (`WeekGrid`) is now the default view (spec: `docs/design/planner-ux.md`), `EventPopover` for viewing/editing an item, `PlannerRail` for due-soon unscheduled tasks/assessments, inline scheduled-session create via `CreateSessionPopover`, `?event=&date=` deep links, and click-through from month/agenda cells into the week view.
- **Dashboard**: `CourseCards` merges grade + mastery + assessment progress per course; `WeekView` is a collapsed/expanded island (state in `sb:weekview`). The old `WeekStrip`/`GradeSnapshot`/`CourseMiniGrid` components were deleted.
- **Feed**: Pinterest-style masonry grid, favicon tiles per resource (fetched from the link's hostname), course chip filters.

### v1.2-Specific Deferrals

Called out separately because they were identified but explicitly not built during this pass:

- **Planner mini-month jump**: no compact month-picker dropdown for jumping the week/month view to an arbitrary date — only prev/next and "today" navigation exist today.
- **Session DELETE endpoint**: **RESOLVED v1.6** — `PATCH /sessions/:id` (reschedule `scheduled_at`/`planned_minutes`, rejects once the session is completed) and `DELETE /sessions/:id` (hard delete, ownership-checked) both now exist (`services/sessions.ts::updateSession`/`deleteSession`, new route `src/pages/api/v1/sessions/[id].ts`) — see `docs/api.md`'s "v1.6 Additions" section. The `EventPopover` UI follow-up flagged here is now also done: it wires a Delete action (inline confirm step) and a ±30-minute reschedule nudge against these endpoints for `study_session` items.
- **Planner drag-to-create**: **RESOLVED v1.6** — pointer-drag on a `WeekGrid` day column (mouse only; touch keeps tap-to-create) selects a time range with a live ghost block, snapped to 15-minute increments; releasing opens `CreateSessionPopover` pre-filled with that range and a type picker (Study session / Class / Other), routing to `POST /sessions`, `POST /courses/:id/class-sessions`, or `POST /tasks` respectively. A plain click still creates a 30-min default block as before. `docs/design/planner-ux.md` §5 has the updated interaction spec.
- **PlannerRail click-to-schedule**: clicking a rail item jumps the grid to that item's week but doesn't schedule it; there's no click-to-schedule or drag-to-schedule from the rail onto the grid yet (v2).
- **App-wide horizontal overflow at ~400px viewport width**: fixed in the v1.5 mobile-shell wave (2026-08-14, see the status line above) — below `@media (max-width: 767px)` is now a first-class bespoke layout (bottom nav, sheets, full-page planner/tasks), not just a narrower desktop squeeze. `scripts/layout-check.cjs`'s mobile pass (`CONFIG.mobileViewportWidths: [390, 430]`) guards the regression going forward.
- **Term-position bar on course cards**: `CourseCards` shows grade/mastery/assessment progress but no "week N of M" term-position indicator — needs term start/end bounds, which aren't modeled yet (`courses.term` is a free-text string, not a date range).
- **Unauthenticated shell/theme parity**: `/login` is standalone and imports Compass/Campus fonts but omits `fonts/focus.css`; `/sign-in`, `/sign-up`, and `/account` render bare Clerk components rather than the branded shell. Consolidate these routes and remove the obsolete `LoginForm.svelte` path.
- **Notifications page + bell footer parity**: the todo/scratchpad popovers have `All tasks →`/`All notes →` footer links to real pages, but the notifications bell has no footer because no `/notifications` page exists (the popover is the whole surface). Visual-QA reviewers flag the asymmetry every round — deliberate deferral until a notifications history page is worth building.

## v1.1 Shipped Summary

- **Rename**: studybuddy → studyus across infra (`wrangler.jsonc`, `package.json`, seed script, session cookie name `studyus_session`), UI strings, and ~17 docs files. `rg -i studybuddy` clean outside `courses/` + `prototype/` (frozen reference dirs).
- **Design system**: 3 themes (compass default, focus, campus) × light/dark/system scheme, OKLCH tokens in `src/styles/{tokens,base}.css` + `themes/{compass,focus,campus}.css`. No-flash theming via `ThemeScript.astro` + SSR-stamped `<html>` attributes from `users.settings`. The prior "notebook" theme, its `COMPAT` alias block, and `notebook.css` were retired in P3 — zero remaining references to the old `--panel`/`--ink`/`--paper`/`--rule`/`--serif`-family variable names or `.sheet`/`.margin-note`/`.status-good`/`.status-warn` classes anywhere in `src/`.
- **Shell**: collapsible Sidebar (Home, current-term courses w/ hue tints, Add course, past-terms) + sticky Header (Record Event pill, scratchpad popup, todo dropdown, notifications bell, avatar menu) replacing the old two-group sidebar nav.
- **Dashboard**: campus-style composition (WeekStrip, GradeSnapshot, CourseMiniGrid, RecordEventCard, DueList) replacing the old calendar-strip layout.
- **Planner**: `/planner` full-viewport modal over AppShell (PlannerView/CalendarGrid/AgendaList); `/calendar` now a 302 redirect there.
- **Course subroutes**: `/courses/[slug]/{index,concepts,notes,resources,practice,play}` replacing the single tabbed course page — Practice (drills: StudyFlow + QuickQuiz) and Play (exploratory: interactive models + self-explain) are new, distinct from each other per the user's "drills vs. exploratory" split.
- **Notifications**: real `notifications` D1 table with read state, idempotent sweep (assessment-due, task-overdue, KC-review, session-unfinished, grade-recorded), 30-day/100-row retention.
- **Add course**: `POST /courses` (slug collision suffixing, auto General branch) + `PATCH /courses/:id` (incl. `archived`, `color_hue`); archived courses now excluded by default from every list/picker (`listCourses` service, `includeArchived` opt-in), with a collapsed "Archived" section on `/courses` as the one exception.
- **Per-course color**: single canonical `hueFor`/`hashHue` in `src/lib/courseHue.ts` (previously duplicated inline across Sidebar.astro, CourseLayout.astro, and two planner components).
- **Tests**: 115 passing (up from v1's 94) — notifications sweep/dedupe/retention, course create/archive/slug-collision, settings merge, tutor list filter, archived-filter default.

## M0–M5 Completion Summary

**M0**: Scaffold, D1 schema, seed data, hand-rolled auth, AppShell layout.

**M1**: Core services (courses, KCs, events, mastery fold), API routes, frozen contract.

**M2A**: Admin dashboard (calendar, grades, Standing tab with course/KC mastery rollups).

**M2B**: Course area (KC detail, branches, R2 file uploads/downloads, attachment management).

**M2C**: Notes & tasks UI (create, link to KCs, delete).

**M2D**: Feed UI (canonical/feed resources, seed data seeded from courses.json, course-scoped resource discovery).

**M3**: Study flow (session create/complete, event logging, mastery updates via events service).

**M4**: AI tutor (OpenRouter integration, five modes: recall/classify/worked_example/self_explain/interactive_model, per-KC context assembly, message cap + auto-end) + quick_quiz (question generation, answer submission with mastery deltas, study_sessions reuse).

**M5**: Onboarding (stepper walkthrough, name + term setup, course selection), learner profile (overall mastery, by-course breakdown, streaks, recent events), design pass (Svelte refinements, responsive layout), smoke tests (API contract verification).

---

## Deferred Features (Post-v1)

### v1.1-Specific Deferrals

Called out separately because they were explicitly scoped out during v1.1 planning (`docs/api.md`'s `tasks.source` and courses sections note the seams left for these):

- **System-generated tasks** — shipped in v1.4 (see the status line above): `services/taskSweep.ts` now generates six families of `system`-sourced tasks (`attend_class`, `prep_before_class`, `review_after_class`, `practice_kc`, `stale_kc`, `grade_entry`), each independently toggleable via `settings.task_generators`, run as an idempotent sweep at the top of `listTasks`/`getCalendar` — the "natural pairing with the notifications sweep" anticipated here turned out to be its own sweep of the same idempotent-generator idiom, not a literal extension of `sweepNotifications`.
- **Branch/KC CRUD**: `POST /courses` auto-creates one "General" branch; there's still no way to add/edit/delete branches or KCs after course creation outside the seed script. Needed before "add a course" is a complete self-serve flow.
- **Deploy pipeline**: `npm run deploy` exists, but there is still no CI/CD workflow, environment promotion, or rollback policy. See Operational TODOs below.

Still deferred: external Flue/channel adapters, native iPad, a genuine global catalog/transitive knowledge-map layer, real social learning, and AFM/BKT/spaced-repetition research work.

### v1.5-Specific Deferrals

Found during the mobile-shell verification pass (M3), not fixed there because the owning file wasn't in scope for that track:

- **Planner mobile toolbar overflow**: at both mobile-shell widths (390px and 430px), `/planner`'s view-toggle (Week/Month/Agenda chips) plus the current-term `<select>` don't fit their available row width (~407px needed vs. ~358–398px available) — the rightmost chip is visually clipped at the viewport edge. The overflow is silently absorbed by the route panel's own `overflow: auto` (it makes the whole mobile planner page horizontally scrollable by a few tens of px) rather than surfacing as page-level scroll, so `scripts/layout-check.cjs`'s `no-right-edge-overflow` doesn't catch it — that check intentionally exempts anything inside an `overflow: auto`/`scroll` ancestor for legitimate horizontal scrollers (e.g. WeekView's day strip), which this coincidentally satisfies without actually being one. Found by eyeballing the `mobile-390--planner` shot from `scripts/visual-qa.mjs`'s new mobile pass. Likely fix: `src/components/planner/PlannerView.svelte`'s `@media (max-width: 767px)` block gives `.controls select` an explicit `min-width: 0` but not the sibling `.view-toggle` — a flex item that's itself a flex container floors, absent that override, at its children's summed min-content width (~221px for the three chip labels), the same class of fix already applied elsewhere (e.g. `dashboard.astro`'s `.rail`/`.rail > div`/`.rail :global(select)`).

### Verification-Pass Deferrals (2026-08-15)

Flagged during the T6 `apiFetch` consolidation's verification pass, not fixed there because each is a behavior change, not a like-for-like refactor:

- **Unhandled-rejection risk at remaining EventTimeline calls**: StudyFlow's completion
  and discard paths now use `apiFetch`; `src/components/events/EventTimeline.svelte`'s
  `saveEdit` and `remove` still use raw `fetch` with no catch and remain deferred.
- **`GradeTable`'s private `formatDue` vs. `plannerDates.formatDueDate`**: `src/components/admin/GradeTable.svelte`'s `formatDue(ms: number | null)` renders the same string (`toLocaleDateString` with `{month:'short',day:'numeric',year:'numeric'}`, "No due date" fallback) as `formatDueDate(iso: string | null)` in `src/lib/plannerDates.ts`, but the two take different input shapes — `GradeTable`'s `Assessment.dueDate` is an epoch-ms number, while `formatDueDate`'s only caller (`AssessmentsCard`) passes an ISO string — and their null-checks diverge (`ms === null` vs. `!iso`, which would treat an epoch-0 timestamp differently). Not a byte-identical swap without either widening the shared helper's signature (which changes its falsy-check semantics) or converting at the call site, so it's booked here rather than merged speculatively.

### Verification-Pass Deferrals (2026-08-19, v1.9 wave)

Flagged during the ZPD/capabilities/rituals verify pass, not fixed there because each is a scope addition or a behavior change, not a like-for-like fix:

- **FrontierGraph edge rendering**: `FrontierGraph.svelte` (`/profile`'s Frontier panel) renders frontier KCs as a flat chip list sharing `PrereqGraph.svelte`'s node styling, but draws no prerequisite edges between them — every node shown is, by definition, already `ready`, so there's nothing currently blocked to draw an edge *to*. Drawing the edges themselves (e.g. dimmed lines into the blocked KCs just past the frontier) would need `FrontierByCourse` to also carry the blocked set per course, not just frontier counts.
- **Per-course blocked counts**: `GET /api/v1/profile/frontier`'s `FrontierResponse` only reports a single global `blocked` count (`counts.blocked`), not a per-course breakdown — `frontierByCourseSchema` (`src/lib/schemas/zpd.ts`) would need an additive `blocked_count` (or a full blocked-KC list, see the FrontierGraph item above) field per course to show "3 waiting on a prerequisite" scoped to one course rather than only the whole-profile summary.
- **RitualsPanel create form has no after_class/before_class cadence**: `RitualsPanel.svelte`'s create form only offers `daily`/`weekly` cadences (`CADENCE_OPTIONS`) because it isn't given a `courses` prop, and `after_class`/`before_class` rituals require a `course_id`. A course-scoped ritual can still be created directly via `POST /api/v1/rituals`, just not from this form. Needs `profile.astro` to pass the user's course list down and the form to grow a course picker for those two cadences.
- **Frontier query dedupe — resolved**: `profile.astro` computes the frontier once and passes its counts to `getProfile`.

### Core Features

### New Learner Onboarding & Course Ingestion

**Core path shipped.** The two-minute public trial, browser-local draft,
Clerk handoff, authenticated route gate, university/semester/preferences,
template/manual/local-document paths, prerequisite-aware rich review, atomic
full-template cloning, and the meaningful-KC completion invariant are
implemented. Remaining work is durable R2 ingestion and extraction
improvements; post-onboarding branch/KC maintenance is shipped. See
`docs/product/onboarding.md`.

Clerk now owns passwords, verification, reset, and sessions. PBKDF2/legacy
session code is retained only to import old accounts. Role-based authorization
for future instructor/institutional surfaces remains deferred.

### Behavioral Activity Stream

Deliberate-capture PostHog emitter paths are implemented for 45 of 46 approved names,
with the anonymous D1 trial stream mirror-forwarded separately when analytics is
enabled. Checked-in delivery remains off pending an operational gate/token decision.
Keep UI telemetry out of D1 `events`; decide whether to implement the intended
`resource_saved` transition or prune it, then define analysis filters and
funnel/reporting conventions before relying on coach digests or product dashboards.

## Mastery Inference

### AFM (Additive Factors Model)

**Scope**: Extend the v1 fold to estimate per-KC learning rate and per-instructional-method effectiveness.

- Model: `log-odds = base + sum(factor_effects)`.
- Factors: KC, instruction type (worked example, self-explanation, etc.), student background.
- Outcome: More nuanced mastery curves; predict future performance.

**Rationale**: Post-v1 research direction; requires larger event dataset.

### BKT (Bayesian Knowledge Tracing)

**Scope**: Probabilistic state-space model of KC mastery.

- Latent states: KC is learned/not-learned (unobserved).
- Parameters: guess (guess correctly despite not knowing), slip (fail despite knowing), learn (P(learn | attempt)).
- Inference: EM or particle filtering to estimate KC state from observations.

**Rationale**: Standard in ITS research; improves mastery confidence estimates.

### Spaced-Repetition Scheduler

**Scope**: Recommend review timing based on forgetting curve + mastery uncertainty.

- Algorithm: SuperMemo SM-2 or modern variants.
- Input: KC mastery, last review, review history.
- Output: "Time to review this KC (70% likely to forget by then)".

**Rationale**: Powerful for retention; requires robust mastery model (AFM/BKT).

## Content & Feed

### Real Social Feed

**Current**: Curated seed + user-added resources (static links).

**Post-v1**: True social learning:
- Peer resource recommendations ("Sarah shared a great Bernoulli derivation").
- Upvoting / flagging resources.
- Comments on resources.
- Resource collections (study guides, playlists).

**Scope**: Clerk accounts already provide multi-user identity, but the feature still requires a sharing/visibility model, social graph or groups, moderation policy, privacy controls, and feed/search ranking.

### Exercise Bank

**Shipped, v2.0**: Real per-KC auto-gradeable exercises — `exercises` table, seeded from `courses/<slug>/exercises.json` (sibling to `content.json`, frozen contract `courses/exercise-schema.md`): 748 exercises across 172 KCs (25 KCs added this wave) over the 9 seeded courses. `mcq`/`numeric` kinds are auto-graded (`POST /exercises/:id/attempt`); `worked` is self-checkable study material. `POST /flows/quick_quiz` now prefers this seeded `mcq` bank over an OpenRouter call, so quiz assessment works end-to-end with no `OPENROUTER_API_KEY` configured for any KC the bank covers. See `docs/architecture/data-model.md`'s `exercises` section and `docs/architecture/events-and-mastery.md`'s "Exercises: The Auto-Gradeable Complement to Scaffolds" section.

**Still open**:
- **Coverage stats surface**: no UI shows which KCs have a thin or missing exercise bank (e.g. an instructor/content-admin view, or just a `practice-summary`-style aggregate) — the 748/172 count above is a one-off wave tally, not a queryable metric today.
- **User-authored exercises UI**: `exercises.origin` is schema-ready for `'user'` (mirrors `misconceptions`/`scaffolds`' seed/user split), but there's no authoring route or form — a student can't add their own practice item to a KC yet.
- **Difficulty-adaptive selection in shipped flows**: `src/lib/domain/pedagogy/exercise.ts` now selects bank items near a learner's mastery for the new exercise engine, but QuickQuiz and the KC-detail Exercises UI still use their older selection/display paths. Unify them behind the engine before calling adaptive difficulty learner-facing.

### Learning to Learn Course

**Future, opt-in first-party content.** Build a normal studyus course whose KCs
teach retrieval practice, spacing/interleaving, self-explanation, error
analysis, calibration, planning, and reflection. It should use ordinary
branches, prerequisite edges, scaffolds, exercises, rituals, and events so the
student learns the system by practicing the strategies in it.

Offer it after a learner has established at least one real academic course. It
must not be auto-enrolled, become a gamified compliance track, or satisfy the
onboarding requirement in place of a real course.

### Global Knowledge Map

**Resolved, v1.9**: `LearnerProfile.knowledge_map` is no longer `null` — `GET /api/v1/profile/frontier` (`src/lib/zpd.ts`/`src/lib/services/zpd.ts`) computes the ZPD learning frontier (unmastered KCs whose every prerequisite is `ready`) across all non-archived courses, grouped by course, on `/profile`'s Frontier panel. This is the "nodes: KCs across all courses, edges: prerequisite" half of what was scoped below — still a pure per-request traversal, no persisted closure table.

**Still open** (not built by v1.9): a genuine transitive-closure / derived-mastery adjustment (e.g. "To master Navier-Stokes, strengthen Conservation of Momentum first" as a *mastery* recommendation, not just a readiness gate) and adaptive sequencing beyond "here's what's unlocked." See `docs/architecture/events-and-mastery.md`'s "Prerequisite modeling" TODO for the mastery-adjustment half specifically.

## Platforms & Channels

### iPad Client

**Current**: Webapp only (responsive design, but not optimized for tablet).

**Post-v1**: Native SwiftUI app for iPad.

- Offline-first sync (CloudKit or local SQLite).
- Pencil-based note-taking (Apple Pencil integration).
- Study planner with calendar widgets.
- Tutor chat optimized for larger screen.

**Scope**: Separate codebase (Swift); reuse API contract from `docs/api.md`.

### External Agent Channels

**Current**: The single-Worker, per-learner SQLite Durable Object runtime is implemented for web tutor conversations, tool-call/session/alarm state, one-time D1 transcript import, and an authenticated browser projection. The shared Nanostore reconciles streaming/close mutations with the DO and revalidates on tab return; course history resumes exact conversations. Four transport-free pedagogy engines also exist. Flue and external channel adapters are not implemented.

**Post-v1**: Deploy Flue agents to multiple channels:

- **Telegram channel**: `/quiz` → quick MCQ on the bus.
- **SMS channel** (Twilio): "Text START to studyus" → tutor over SMS.
- **Discord bot**: Study group channel integration (announce events, record study sessions).
- **Email digest**: Daily study recommendation based on mastery.
- **Slack bot**: For schools with institutional Slack.

**Scope**: Flue API stabilization, verified channel-identity linking to the same local learner id, channel-specific UX, consent, rate limiting, and delivery/retry semantics. External adapters must not duplicate domain logic or create per-channel learners.

## AI & Tutoring

### Advanced Tutor Modes

**Current**: Static KLI mode selection and absorb chat are learner-facing. The new instruction/exercise/admin/orchestrator modules exist as a tested library foundation but are not mounted into a learner-facing coach flow.

**Post-v1**:
- Mount the existing session orchestrator as a learner-facing flow with durable session state.
- Strong-KC analogy selection and explicit prereq-gap-filler/spoonfeed behavior.
- Adaptive difficulty across QuickQuiz, KC exercises, and placement/diagnostic purposes.
- Mode switching (if student isn't progressing in one mode, suggest another).
- Knowledge map integration (tutor suggests related KCs to study).

**Scope**: Prompt engineering, agent planning algorithms.

### Interactive Model Rendering (Advanced)

**Current**: Basic sliders + constraint re-evaluation (math.js).

**Post-v1**:
- 2D/3D visualization (e.g., Bernoulli streamlines, pressure field).
- Symbolic math (SageMath or similar, for derivation walkthroughs).
- Physics simulation (drag forces, gravity, etc.).

**Scope**: 3D library integration (Babylon.js, Three.js), expensive computations (serverless function).

## Analytics & Insights

### Learning Analytics Dashboard

**Current**: Learner profile (mastery, streaks) plus operational deliberate behavioral
capture for 45 of 46 cataloged events, but no reporting UI, trends, or cohort
comparisons.

**Post-v1**:
- Time spent per KC (heatmap by week).
- Most challenging topics (bottleneck analysis).
- Study session effectiveness (pre-test vs. post-test mastery).
- Peer benchmarking (how does my mastery compare to classmates?).
- Course success predictor (based on current trajectory).

**Scope**: Analytics DB (separate from operational DB), visualization library, privacy (anonymization).

### Educator Dashboard (Instructor View)

**Current**: Single-student app; no instructor features.

**Post-v1**:
- Class mastery overview (which KCs is the cohort struggling with?).
- Assignment analytics (score distribution, common errors).
- Student-level intervention prompts ("Alice is at risk in Thermodynamics").
- Curriculum effectiveness (which KCs improve most after instruction?).

**Scope**: Role-based access control, institutional deployment, data privacy.

## Operational

### CI/CD Pipeline

**Current**: No CI workflow. Tests/check/build run locally; `npm run deploy` exists but is a direct local build + Wrangler deploy with no promotion or rollback automation.

**Post-v1**: A GitHub Actions workflow on PR/push that runs, in order: `npm test` (Vitest + pool-workers), `npm run check` (wrangler types + astro check), `npm run build` (astro build — catches anything the type checker doesn't), and `npm run test:e2e`. The Playwright configuration now owns its Astro dev server and Clerk setup; CI still needs Clerk test-instance secrets. Keep `npm run test:e2e:visual` as a slower artifact-producing job, either on UI-changing PRs or on demand.

`@types/node` is installed and the current type check reports zero errors. Keep CI wording tied to actual command results rather than preserving resolved setup notes.

**Scope**: `.github/workflows/ci.yml` and secrets for any Cloudflare API tokens if a deploy step is added later.

### Monitoring & Observability

**Post-v1**: Deploy production monitoring:
- Cloudflare Analytics Engine (event tracing).
- Error tracking (Sentry or similar).
- Mastery fold performance (query & recompute latency).
- API response times (SLA tracking).

**Scope**: Dashboard setup, alerting thresholds.

### Database Optimization

**Resolved 2026-08-15 (F0 track)**: "No indexing beyond basic lookups" is no longer true — the baseline migration now carries 15 indexes (composite + unique) covering event timelines, mastery rollups, calendar coalesce filters, and every sweep's dedupe keys. See `docs/architecture/data-model.md`'s Index Inventory section for the full, current list, and ADR-003's erratum for why the old "indexing strategy defined post-v1" note there was also stale. The two specific indexes originally called for below **did** land, in slightly different shape than proposed (`events_user_ts_idx` on `(user_id, ts)` rather than `(user_id, course_id, ts)` — `course_id` wasn't needed for the query patterns that actually showed up; `kcs_course_id_idx` on `(course_id)` covers mastery rollups via the `course_id` join rather than a direct `(user_id, kc_id)` index, since `kcs` has no `user_id` column).

**Still open, unchanged**:
- Partitioning if events table grows (post-large-scale).
- Query plan analysis (EXPLAIN) / profiling / slow-query logging — no query-level performance work has been done beyond adding the indexes above.

### Backup & Disaster Recovery

**Post-v1**: Establish backup policy:
- D1 snapshots (daily).
- R2 versioning or archival bucket.
- Event log immutability (cannot delete/modify after retention period).

**Scope**: Backup job scheduling, restore procedures.

## Design & UX

### Onboarding Depth

Functional course provisioning and its completion invariant are implemented.
Next add short contextual guidance on the newly created course and keep longer
videos, tours, or FAQ content optional and dismissible.

### Design Polish

**Post-v1**: Visual refinement:
- Consistent color palette & typography.
- Animation & micro-interactions (transitions, loading states).
- Accessibility audit (WCAG 2.1 AA).
- Dark mode toggle.

**Scope**: Design system documentation, designer time.

### Motivational Features

**Current**: Pure information; no gamification.

**Post-v1**:
- Achievement badges (e.g., "Mastered 5 KCs in one week").
- Streak display and celebrations.
- Reflection prompts (after study, after exams).
- Study goal setting ("Master Thermodynamics by exam date").

**Scope**: Research on intrinsic vs. extrinsic motivation, careful deployment to avoid dark patterns.

## Testing & Quality

### E2E Test Automation

**Current (shipped 2026-08-27)**: Playwright starts Astro in foreground
E2E mode, creates a real Clerk test session once, and reuses its storage state
for authenticated suites. `npm run test:e2e:auth` exercises the Clerk handoff;
`npm run test:e2e` covers live documentation annotations, course-map hydration
and editing, same-origin resource failures, and the 376-assertion responsive
layout harness; `npm run test:e2e:visual` captures 95 desktop/mobile/landscape,
theme, interaction, and modal states while checking console, page, and
same-origin HTTP errors. Vitest explicitly excludes `tests/e2e/**` so the
Cloudflare Workers pool and Playwright keep separate runtimes.

**Remaining**:
- Wire the three tiers into CI with Clerk test-instance secrets and retained
  failure/screenshot artifacts.
- Add Firefox/WebKit once Clerk and the app's supported-browser policy require
  them; current automated coverage is Chromium across desktop, tablet-width,
  phone portrait, and phone landscape layouts.
- Add performance tests (load, stress) separately from functional E2E.

**Scope**: CI integration, browser policy, and performance infrastructure.

### Load Testing

**Post-v1**: Validate Cloudflare scalability:
- Simulate 1000+ concurrent users.
- Measure D1 concurrency limits.
- R2 upload throughput.
- API SLA compliance.

**Scope**: Load testing tool setup, bottleneck identification.

---

## Priority Order (Rough Estimate)

**Tier 1** (Within 2–3 months post-v1):
- Multi-user signup.
- iPad client (parallel with v1 wrap-up).
- Flue agents + SMS/Telegram channels.
- Analytics dashboard (basic).

**Tier 2** (3–6 months):
- Argon2 migration.
- Real social feed.
- Knowledge map.
- Advanced tutor modes.
- Educator dashboard.

**Tier 3** (Post-6 months / research):
- AFM/BKT mastery.
- Spaced-repetition scheduler.
- 3D visualization for interactive models.

---

## Notes

- All deferred features have a placeholder (`// TODO`) in code or a stub in the docs.
- Features are scoped to avoid goldplating; each one has clear "done" criteria.
- API contract (docs/api.md) is stable across all post-v1 features; they extend via new endpoints or flow types, not rewrites.
