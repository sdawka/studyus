# studyus Roadmap: Deferred Features

**M0–M5 Status (2026-08-11)**: Core v1 complete. Frozen API contract (docs/api.md), mastery fold, core UI, AI tutor, quick_quiz flows shipped.

**v1.1 Status (2026-08-12)**: Rename (studybuddy → studyus, incl. session cookie name) + full UI overhaul shipped. See "v1.1 Shipped Summary" below. Features under "Deferred Features (Post-v1)" remain deferred; a few new deferrals were added by v1.1's own scoping decisions (called out inline).

**v1.2 Status (2026-08-12)**: Unified calendar data plane, design-token/popover foundation, three theme design passes (fonts + colors + spacing + motion, structure unchanged), planner overhaul (week time-grid default, EventPopover, PlannerRail, inline session create, deep links), dashboard recomposition (CourseCards, collapsible WeekView), and a Pinterest-style feed masonry shipped. See "v1.2 Shipped Summary" below. Note: the components named in "v1.1 Shipped Summary" below (WeekStrip, GradeSnapshot, CourseMiniGrid) were deleted as part of v1.2's dashboard recomposition — that section is left as a historical record of what v1.1 shipped, not a description of current code.

**v1.4 Status (2026-08-13)**: Task-centric platform. Real task rows for every checkable thing (`type` enum, `description`, one level of subtasks, origin FKs) replace the old title/due-date/done-only shape; six independently-toggleable sweep generators (`services/taskSweep.ts`) populate `tasks.source = 'system'` — the exact gap this doc flagged as deferred under "v1.1-Specific Deferrals" below, now resolved; two-way sync between `attend_class` tasks and class-session attendance, and between `grade_entry` tasks and grade entry; KC↔assessment linking gets a UI (`assessment_kcs`, via AssessmentsCard's "Concepts covered" picker); dashboard leads with `TodayTasks` (checkable hero) ahead of slimmed `CourseCards`; `/tasks` rebuilt as a full-page route-modal with per-course cards and subtasks; a new course-home `TasksCard` and a `/settings` "Automatic tasks" panel. Full contract in `docs/api.md`'s "v1.4 Additions" section.

**v1.5 Status (2026-08-14)**: Mobile layouts + PWA shell. Adaptive shell below `@media (max-width: 767px)` (`MOBILE_QUERY` in `src/lib/stores/viewport.ts`): bottom tab bar (Home/Tasks/Record-FAB/Planner/Courses) replaces the sidebar, header popovers become bottom sheets, `/planner` and `/tasks` become full tab pages instead of centered modals; every page got a bespoke mobile composition (dashboard leads with tasks, planner defaults to Agenda with a container-measured 1/3/7-day WeekGrid, touch-sized task rows, course StandingTab reordered around the "hallway jobs"); a basic PWA shell (manifest, icons, safe-area insets, no service worker). Full contract in `docs/design/mobile-shell.md`. This wave also fixed the app-wide ~400px overflow flagged below and a latent **desktop** bug: `main`'s `container-type: inline-size` was trapping the planner/tasks route-modal layers' `position: fixed` descendants (scrim, EventPopover, CreateSessionPopover, WeekGrid's hover card) inside `main`'s box instead of the viewport — an overlay slot (`AppShell.astro`, direct `<body>` child after `.shell`) fixes both.

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
- **Fonts on unauthenticated pages**: `login.astro` renders standalone (doesn't use `AppShell.astro`) and imports `tokens.css`/`themes/*.css`/`base.css` directly but not any `fonts/*.css` — confirmed the login page falls back to system fonts regardless of the active theme, since the `@fontsource` `@font-face` declarations never load there.
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
- **Deploy pipeline**: v1.1 was explicitly local-only per its build plan (no deploys during P0-P3); there's still no CI/CD or `wrangler deploy` step wired to this rename/shell — see "CI/CD pipeline definition" under Operational TODOs below, now also blocking a production rollout of the new shell.

Still-deferred from v1 (unchanged by v1.1, see full detail further down): Flue agents + channels, global knowledge map, iPad client, multi-user signup, argon2 password hashing.

### v1.5-Specific Deferrals

Found during the mobile-shell verification pass (M3), not fixed there because the owning file wasn't in scope for that track:

- **Planner mobile toolbar overflow**: at both mobile-shell widths (390px and 430px), `/planner`'s view-toggle (Week/Month/Agenda chips) plus the current-term `<select>` don't fit their available row width (~407px needed vs. ~358–398px available) — the rightmost chip is visually clipped at the viewport edge. The overflow is silently absorbed by the route panel's own `overflow: auto` (it makes the whole mobile planner page horizontally scrollable by a few tens of px) rather than surfacing as page-level scroll, so `scripts/layout-check.cjs`'s `no-right-edge-overflow` doesn't catch it — that check intentionally exempts anything inside an `overflow: auto`/`scroll` ancestor for legitimate horizontal scrollers (e.g. WeekView's day strip), which this coincidentally satisfies without actually being one. Found by eyeballing the `mobile-390--planner` shot from `scripts/visual-qa.mjs`'s new mobile pass. Likely fix: `src/components/planner/PlannerView.svelte`'s `@media (max-width: 767px)` block gives `.controls select` an explicit `min-width: 0` but not the sibling `.view-toggle` — a flex item that's itself a flex container floors, absent that override, at its children's summed min-content width (~221px for the three chip labels), the same class of fix already applied elsewhere (e.g. `dashboard.astro`'s `.rail`/`.rail > div`/`.rail :global(select)`).

### Verification-Pass Deferrals (2026-08-15)

Flagged during the T6 `apiFetch` consolidation's verification pass, not fixed there because each is a behavior change, not a like-for-like refactor:

- **Unhandled-rejection risk at two un-migrated fetch call sites**: `src/components/study/StudyFlow.svelte`'s `discardSession` and `submitCompletion`, and `src/components/events/EventTimeline.svelte`'s `saveEdit` and `remove`, each wrap their `fetch` call in `try { ... } finally { ... }` with no `catch` clause — a network-level throw (offline, backend redeploying) is an unhandled promise rejection with zero user-visible feedback, unlike every other call site (now on `apiFetch`, which catches and surfaces `NETWORK_ERROR_MESSAGE`). Left alone because migrating them to `apiFetch` would newly surface errors that previously failed silently — desired, but a deliberate future change, not this pass's scope.
- **`GradeTable`'s private `formatDue` vs. `plannerDates.formatDueDate`**: `src/components/admin/GradeTable.svelte`'s `formatDue(ms: number | null)` renders the same string (`toLocaleDateString` with `{month:'short',day:'numeric',year:'numeric'}`, "No due date" fallback) as `formatDueDate(iso: string | null)` in `src/lib/plannerDates.ts`, but the two take different input shapes — `GradeTable`'s `Assessment.dueDate` is an epoch-ms number, while `formatDueDate`'s only caller (`AssessmentsCard`) passes an ISO string — and their null-checks diverge (`ms === null` vs. `!iso`, which would treat an epoch-0 timestamp differently). Not a byte-identical swap without either widening the shared helper's signature (which changes its falsy-check semantics) or converting at the call site, so it's booked here rather than merged speculatively.

### Core Features

### Multi-User Signup & Email Verification

**Scope**: Currently, v1 is single-user (seeded user for demo). Multi-user requires:
- Signup form (username, email, password).
- Email verification flow (token, TTL, retry).
- Password reset (forgot-password link).
- Role-based access (student / instructor, post-v1).

**Rationale**: Single-user keeps auth minimal for M0. Multi-user is essential for real deployment but can follow the same hand-rolled session pattern.

### Argon2 Password Hashing

**Current**: PBKDF2 (safe, simple, built-in via Web Crypto).

**Post-v1**: Migrate to argon2-WASM (memory-hard, slower, better against GPU attacks).

**Scope**: Data migration script (re-hash all existing passwords), library integration.

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

**Scope**: Requires multi-user, moderation policy, feed algorithm.

### Global Knowledge Map

**Current**: Stubbed in `LearnerProfile.knowledgeMap = null`.

**Post-v1**: Build a concept prerequisite graph:
- Nodes: KCs across all courses.
- Edges: "X is a prerequisite for Y" (directed, weighted).
- Transitive closure: compute derived mastery for unmastered prerequisites.
- Recommendation: "To master Navier-Stokes, strengthen Conservation of Momentum first."

**Scope**: Knowledge engineering (map each course's KC dependencies), query optimization, adaptive sequencing.

## Platforms & Channels

### iPad Client

**Current**: Webapp only (responsive design, but not optimized for tablet).

**Post-v1**: Native SwiftUI app for iPad.

- Offline-first sync (CloudKit or local SQLite).
- Pencil-based note-taking (Apple Pencil integration).
- Study planner with calendar widgets.
- Tutor chat optimized for larger screen.

**Scope**: Separate codebase (Swift); reuse API contract from `docs/api.md`.

### Flue Agents + Channels

**Current**: Fully specced in `docs/architecture/agentic-channels.md`, but not implemented.

**Post-v1**: Deploy Flue agents to multiple channels:

- **Telegram channel**: `/quiz` → quick MCQ on the bus.
- **SMS channel** (Twilio): "Text START to studyus" → tutor over SMS.
- **Discord bot**: Study group channel integration (announce events, record study sessions).
- **Email digest**: Daily study recommendation based on mastery.
- **Slack bot**: For schools with institutional Slack.

**Scope**: Flue API stabilization (currently experimental), channel-specific UX, rate limiting.

## AI & Tutoring

### Advanced Tutor Modes

**Current**: Static mode selection by KC type (recall, classify, worked_example, self_explain, interactive_model).

**Post-v1**:
- Multi-turn lesson planning (agent plans a 5-turn arc, not one-shot).
- Prerequisite probing ("Before SN2, let's check SN1...").
- Adaptive difficulty (track performance mid-conversation, adjust).
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

**Current**: Learner profile (mastery, streaks), but no trends or cohort comparisons.

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

**Current**: No CI at all — `npm test`, `npm run check`, and `npm run check:layout` are run locally, on the honor system, before committing. See "Deploy pipeline" note above (still local-only wrangler, no `wrangler deploy` step either).

**Post-v1**: A GitHub Actions workflow on PR/push that runs, in order: `npm test` (Vitest + pool-workers), `npm run check` (wrangler types + astro check), `npm run build` (astro build — catches anything the type checker doesn't). Layout checks (`npm run check:layout`) need a running dev server plus Playwright under Node 20 (see `scripts/layout-check.cjs` header) — either spin up `astro dev` in the background in CI and point the script at it, or defer this step to a separate, slower workflow if startup cost is a problem.

**Also blocking `npm run check` from being fully clean today**: `scripts/seed.ts` and `vitest.config.ts` need `@types/node` (`nodejs_compat` flag requires it per wrangler's own guidance) — not installed yet to avoid a lockfile race with concurrent agent work at the time this was written. `npm i --save-dev @types/node` is a same-day fix once that's safe to do.

**Scope**: `.github/workflows/ci.yml`, secrets for any Cloudflare API tokens if a deploy step is added later, `@types/node` install.

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

**Current**: Svelte stepper to explain KCs, set name, confirm courses. Minimal.

**Post-v1**:
- Video tutorials (how to use the app).
- Guided walkthroughs (first login → first event → first tutor session).
- Contextual help tooltips.
- FAQ & troubleshooting.

**Scope**: Content creation, UX testing.

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

**Current**: Manual smoke tests per milestone.

**Post-v1**:
- Playwright or similar for automated E2E tests.
- Test matrix (browser, mobile, tablet).
- Performance tests (load, stress).

**Scope**: Test infrastructure, CI integration.

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
