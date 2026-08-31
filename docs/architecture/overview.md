# studyus Architecture Overview

## Stack (Pinned 2026-08-11)

- **Frontend**: Astro 7.2 + Svelte 5.56 islands (`@astrojs/svelte` 9), `output: 'server'` SSR.
- **Hosting & Database**: Cloudflare Workers (via `@astrojs/cloudflare` 14.2) + D1 SQLite + Drizzle ORM 0.45.2.
- **Storage**: Cloudflare R2 (file uploads).
- **AI**: OpenRouter API (LLM proxy for tutor, via SSE).
- **Auth**: Clerk via `@clerk/astro`, resolved on every request to an immutable local D1 learner id (`users.id`). The legacy session/password code remains only for account migration compatibility; see `authentication.md`.
- **Validation**: Zod 4 (top-level `z.email()`, `z.strictObject()`).
- **Testing**: Vitest 4.1 + `@cloudflare/vitest-pool-workers` 0.21 (real bindings, per-file isolation).

## Key Principles

### Headless, Tool-Shaped Services
Business logic is transport-free and user-scoped: services accept `(db, userId, input)` with Zod-validated input, while the newer pedagogy modules accept a `DomainContext`. Deterministic CRUD/folds live in `src/lib/services/`; the learner-profile facade and four pedagogy engines live in `src/lib/domain/`.
- Callable from HTTP routes and server-rendered pages today. The tutor's per-learner Durable Object is the ordered runtime shell; future Flue/MCP/channel adapters must call the same services/domain modules rather than acquire business logic.
- Route handlers under `src/pages/api/v1/**` only: parse the request (Zod), call one service function, wrap the result in `apiOk(toApi(result))` (or `apiError`/`withServiceErrors` on failure). See `docs/api.md` for the full endpoint list and the "Notes for M2+ agents" section for the calling convention from `.astro` pages vs. islands.
- Ownership is enforced *inside* services (`requireOwnedCourse`/`requireOwnedKc` in `util.ts`) — a route never queries a table directly.
- This shapes the code for the **agentic future**: Flue agents will wrap these same services as tools, unchanged.

### Event-Sourced Mastery
Mastery truth comes from the event log. `kcs.mastery`, `kcs.status`, and `kcs.last_event_at` are recomputable read caches updated only by the event service after a write:
- Events carry dual-role flags (`is_instructional`, `is_assessment`) not a category enum.
- Editable manual events, delete-only system-generated events (with confirmation).
- Every event write triggers a mastery re-fold for affected KCs.
- **The fold is pure**: given the domain log, select role-flagged evidence and compute score/status deterministically; durable context facts never affect score or freshness, and product-usage telemetry lives in a separate behavioral stream. `events-and-mastery.md` and `mastery.ts::MASTERY_CONSTANTS` are authoritative.
- `assessment_kcs.qmatrix_version` is currently a write-only audit/version field; the fold does not consume it.

### Webapp + Frozen API
- **HTTP API** (`/api/v1`) is the single source of truth for client contracts.
- Astro pages call services directly server-side (no self-calls).
- The same API surfaces for native clients (iPad app later).
- Original M1 data shapes remain compatibility-oriented and post-M1 additions are additive where practical. Authentication is the explicit exception: Clerk superseded the retired `/auth/login` and `/auth/logout` endpoints. A native client needs a documented Clerk token/session strategy before the API can honestly be called frozen for iPad.

### Client State (nanostores)
Cross-island state that used to be prop-threaded or duplicated per-component now lives in `nanostores` atoms under `src/lib/stores/`. Svelte 5 subscribes directly via the `$storeName` auto-subscription (nanostores atoms implement `.subscribe`) — no `@nanostores/svelte` adapter needed. `ui.ts`'s `activePopover` (which of the header's popovers — scratchpad/todo/bell/avatar — is open; previously local `$state` in `HeaderActions.svelte`) and `courseContext.ts`'s `courseContext` (the course the user is currently viewing, `{id, slug, code, title} | null`, SSR-safe default `null`) were the first two. `CourseLayout.astro` mounts a tiny invisible `CourseContextSetter.svelte` island (`client:load`) on every course subpage to publish it; `ScratchpadPopup`, `TodoDropdown`, and `LogEventModal` read it to default a course selection — always just a default, never enforced.

`stores/tasks.ts` (v1.4) is the larger third: a `map` of tasks by id, a `TasksStatus` atom (`idle|loading|ready|error`), and plain-function selectors (`selectOpen`/`selectForCourse`/`selectChildren`/`bucketByDue`) rather than a `computed` list, since consumers need to filter/group differently (TodayTasks buckets by due date, TasksView groups by course, CourseTasks/PlannerRail want a plain open-tasks slice). v1.8 adds `recentlyCompletedIds` — a just-completed task is held in that set for `COMPLETION_HOLD_MS` and is passed through each surface's "open" classification with its `completed` flag faked off, so the row keeps its place (struck through, confetti landing) instead of vanishing on the optimistic flip, then leaves via the `taskDepart` transition. `ensureLoaded()` dedupes concurrent first-load fetches across islands on the same page via a module-level promise; `addTask`/`toggleTask`/`deleteTask` mutate optimistically (except `addTask`, which awaits the `POST` and inserts the real row — no temp-id reconciliation) with rollback on a failed request; `refetchTasks()` does a full replace, used after attendance mutations elsewhere on the page so a backend-side `attend_class` sync is picked up without mirroring the sync rule client-side. Every task-consuming island (`TodoDropdown`, `TodayTasks`, `TasksView`, `CourseTasks`, `EventPopover`, `AttendanceCard`) reads and writes through this one store instead of doing its own fetch — `PlannerRail` is the one exception, still server-fetched via props (it only gained a `TaskTypeIcon` on its rows, no structural change).

`stores/learnerRuntime.ts` is deliberately different from application-data stores: it is a browser projection of the authenticated learner Durable Object, never an authority and never persisted in `localStorage`. SSR provides the initial full conversation; the island hydrates it only in the browser, derives interactive models and correction proposals from that transcript, uses temporary message IDs while an SSE turn is visibly streaming, then replaces the optimistic transcript with `GET /tutor/conversations/:id`. `GET /runtime/snapshot` supplies the complete active-conversation/session/alarm projection, revalidated on page show, window focus, and when a hidden tab becomes visible. D1 remains authoritative for courses, tasks, KCs, evidence, and mastery; moving those into this store or the Durable Object would create a competing data plane.

### Design Tokens — 3 Themes × 2 Schemes
The whole app shares one token vocabulary, split across files under `src/styles/`:
- **`tokens.css`** — theme-agnostic derivations only: `--course`/`--course-ink`/`--course-soft` computed from a per-element `--course-h` (0-360, set inline from `courses.color`) plus theme-owned `--course-l/-c` knobs, so the same hue reads correctly in every theme × scheme combination. Derived on the universal selector `*` (not `:root`) so a per-element `--course-h` override actually re-evaluates — a `:root`-level derivation would pin every element to one hue.
- **`base.css`** — reset + primitives that read tokens only, never define colors: `.card`, `.btn`/`.btn-primary`/`.btn-secondary`, `.pill`/`.pill-ok`/`.pill-warn`/`.pill-danger`, `.chip`, `.bar`, `.kicker`, `.empty`, `.aside-muted`, plus a **popover primitive set** shared by every header popup (notifications, todo, scratchpad, avatar menu, planner's EventPopover/CreateSessionPopover): `.popover` (surface + `--shadow-pop`, width via `--pop-w` set inline from a theme's `--pop-w-sm/-md/-lg`), `.panel-head`, `.footer-link`, `.icon-btn`.
- **`themes/{compass,focus,campus}.css`** — the actual OKLCH color/radius/font/spacing/motion *values*, one file per theme. Each defines a light block, an `@media (prefers-color-scheme: dark) [data-theme=X]:not([data-scheme=light])` block, and an explicit `[data-scheme=dark]` block — the same token names resolve differently per theme × scheme, never duplicated as separate class names.
- **`fonts/{compass,focus,campus}.css`** — self-hosted `@fontsource` variable-font `@font-face` declarations, one file per theme, imported by `AppShell.astro`. The standalone `/login` page currently imports Compass and Campus font files but omits `fonts/focus.css`; `/sign-in`, `/sign-up`, and `/account` are bare Clerk routes and do not use `AppShell`. Unifying the unauthenticated shell remains a tracked polish item.

Token contract (present in every theme file): `--bg --surface --surface-2 --text --muted --faint --border --hairline --hover`; `--accent --accent-ink --accent-soft --accent-contrast` (a readable-on-accent text color, for solid-accent buttons/badges); status triples `--good/-ink/-soft --warn/-ink/-soft --danger/-ink/-soft`; sidebar group `--sidebar-bg/-text/-muted/-border/-active-bg/-active-text` (lets focus keep its pinned-dark rail regardless of scheme); structure `--radius-lg/md/sm --font-display/body/mono --font-size-base --shadow-card --shadow-pop`; density/motion `--space-1..6 --motion-fast/-base --weight-med/-semi/-bold --tracking-caps --pop-w-sm/-md/-lg`.

**Themes vary tokens only, never structure.** Compass, focus, and campus differ solely in the *values* behind fonts/colors/spacing/motion — no theme introduces its own component selectors, markup, or class names; the same `.card`/`.btn`/`.popover` etc. render everywhere, just styled differently. Each theme's rationale (voice, type, color story, density, motion, do/don't list) lives in its own doc: `docs/design/compass.md`, `docs/design/focus.md`, `docs/design/campus.md`.

`<html data-theme>` (absent = compass) + `data-scheme` select the active theme/scheme; `ThemeScript.astro` stamps both pre-paint from `localStorage` (`sb:theme`/`sb:scheme`), mirrored server-side from `users.settings` on the next full load. **The default scheme is now `light`** (`resolveSettings` in `src/lib/services/user.ts` defaults new/unset `settings.scheme` to `'light'`, not `'system'`); `'system'` is still a selectable option in `/settings` — choosing it clears the `data-scheme` attribute so the OS `prefers-color-scheme` media query decides, and `ThemeScript.astro` only falls back to stamping `light` itself when there's neither an SSR-stamped attribute nor a `localStorage` override (e.g. no user settings yet), so an OS in dark mode never flashes dark before the user has chosen anything. Three themes: **compass** (default, cool neutral), **focus** (pinned-dark sidebar, higher-contrast accent), **campus** (warm paper tones). A prior "notebook" theme and its `--panel`/`--ink`/`--paper`/`--rule`/`--serif`-family legacy variable names (plus `.sheet`/`.margin-note`/`.status-good`/`.status-warn` compatibility classes) were retired in P3 — every consumer was converted onto the token vocabulary above (`.card` for card-ish blocks, `.aside-muted` for the old margin-note aside styling), and `notebook.css` was deleted. `rg` for any of those retired names/classes now returns nothing under `src/`.

## Repo Structure

**Regenerated 2026-08-15 from the actual filesystem** (`find src/pages tests src/components src/lib -type f`, etc.) — a prior draft of this tree had drifted significantly from reality (missing whole route trees, an invented `tests/unit`/`tests/integration` split that was never built). This tree favors accuracy over exhaustiveness — some leaf directories are summarized by file count rather than listing every file; use `find` yourself for the current exact set if you need it. `dist/`, `.astro/`, `.wrangler/` are gitignored build/state output and omitted below.

```
astro.config.mjs                          # Astro + Svelte islands config
wrangler.jsonc                            # Bindings: D1 (DB), R2 (UPLOADS), vars — real shape, see cloudflare.md
drizzle.config.ts                         # Migration + schema config
.dev.vars.example                         # Template for local secrets (OPENROUTER_API_KEY)

courses/                                  # Seed source data (real, at repo root — not nested under prototype/)
  courses.json                            # The 9 seeded courses (code/title/term/etc.), read by scripts/seed.ts
  content-schema.md                       # v1.7: frozen courses/<slug>/content.json contract (KCs, prereq edges,
                                           #   scaffolds, misconceptions, assessments) — authoritative on shape
  [course-slug]/README.md                 # One per course — human-readable syllabus notes, not read by code
  [course-slug]/content.json              # v1.7: all 9 courses now have one — supersedes that course's
                                           #   courses.json branches/canonical/feed; read by scripts/seed.ts
                                           #   via src/lib/content/courseContent.ts
prototype/                                # Old static-HTML design prototype (frozen, pre-Astro) — index.html,
                                           #   dashboard.html, planner.html, course.html + per-variation CSS/JS
public/                                   # Static assets served as-is: manifest.webmanifest, icons/ (PWA)

migrations/                               # D1 baseline + additive migrations; see ADR-003 current workflow
  0000_chemical_ink.sql
  0001_sticky_white_tiger.sql
  meta/
scripts/
  seed.ts                                 # Idempotent course+KC+demo-data seed
  layout-check.cjs                        # Playwright layout-invariant guard (npm run check:layout)
  visual-qa.mjs                           # Playwright visual-QA driver (screenshots + console errors)
  gen-icons.mjs                           # PWA icon generation

src/
  middleware.ts                           # Clerk → immutable local learner, gates pages + /api/v1
  env.d.ts                                # Augments Cloudflare.Env/Env with OPENROUTER_API_KEY
  db/
    schema.ts                             # Drizzle schema (all tables — see data-model.md)
    client.ts                             # `db` singleton, db.batch pattern
  styles/
    tokens.css                            # Theme-agnostic derivations (--course/-ink/-soft)
    base.css                              # Reset + primitives (.card/.btn/.pill/.popover/...)
    themes/{compass,focus,campus}.css     # Per-theme OKLCH color/radius/spacing/motion values
    fonts/{compass,focus,campus}.css      # Per-theme @fontsource @font-face declarations
  lib/
    auth/                                 # Clerk local-user bridge/import; legacy password/session migration helpers
    domain/                               # learner-profile facade + instruction/exercise/admin/orchestrator engines
    runtime/                              # per-learner Durable Object and tutor runtime ingress
    actions/                              # focusTrap.ts, portal.ts, scrollLock.ts, masonry.ts — Svelte actions
                                           #   for overlays + the /tasks card-grid masonry action
    completionMotion.ts                   # Completion choreography vocabulary: COMPLETION_HOLD_MS (linger),
                                           #   taskDepart (collapse-and-glide out), flow-celebration suppression,
                                           #   prefersReducedMotion. Pure TS so stores/tasks.ts can import it.
    confetti.ts                           # Dependency-free WAAPI confetti burst (every completion path:
                                           #   TaskCheckbox, CompletionFlow's Done button, EventPopover task_due)
    stores/                               # nanostores: ui.ts, courseContext.ts, tasks.ts, learnerRuntime.ts, toast.ts, viewport.ts
    schemas/                              # Zod validators — one file per domain (assessments, attachments,
                                           #   calendar, classSessions, common, corrections, courses, events, kcs,
                                           #   knowledgeMap, notes, notifications, quickQuiz, resources, sessions,
                                           #   tasks, tutor, user)
    content/                              # v1.7: courseContent.ts — Zod schema for courses/<slug>/content.json
                                           #   (authoritative shape lives in courses/content-schema.md) +
                                           #   cross-course prereq-slug resolver, cycle-safe
    types/
      calendar.ts                         # CalendarItem (FROZEN shape; getCalendar is sole producer)
    plannerDates.ts                       # Week/month date-math helpers shared by planner components
    courseHue.ts                          # Canonical hueFor/hashHue (one definition, no duplicates)
    taskTypeMeta.ts                       # TaskType → icon/label metadata (TaskTypeIcon, PlannerRail)
    understandNext.ts                     # Pure selection of the KCs worth an absorb session next (weakest
                                           #   started, stalest as tiebreak, + next untouched) — course home
    tracing.ts                            # Cloudflare Workers trace helpers
    handleNotFound.ts                     # Shared 404 handling
    api.ts                                # Request/response envelope helpers
    apiErrors.ts                          # withServiceErrors / apiError mapping (incl. ZodError → 400 invalid_input)
    serialize.ts                          # toApi (db row → API shape)
    services/                             # Pure (db, userId, input) -> result functions, one file per domain:
                                           #   assessments, attachments, calendar, classSessions, corrections (v1.7),
                                           #   courses, events, grades, kcs, knowledgeMap (v1.7 — BFS depth + DFS
                                           #   back-edge detection, diamond-safe traversal), mastery (pure fold, no
                                           #   db writes), notes, notifications, practiceSummary, profile, resources,
                                           #   sessions, tasks, taskSweep, user, util (ownership/error helpers)
      tutor/
        conversations.ts
        openrouter.ts
        prompts.ts
        modelSpec.ts
    flows/                                # Agentic flows
      quick_quiz.ts                       # Pattern flow: pick KCs, generate, grade, append
  layouts/
    AppShell.astro                        # Sidebar + Header shell; imports tokens/fonts/themes/base.css
    CourseLayout.astro                    # Wraps AppShell; course head + 6-tab bar for /courses/[slug]/*
  components/                             # By feature — Svelte islands + .astro partials side by side
    LoginForm.svelte                      # Obsolete pre-Clerk form; retained temporarily, no live page uses it
    admin/                                # GradeTable.svelte, QuickEventForm.svelte
    corrections/                          # v1.7: CorrectionsLedger.svelte (Active/Internalized/All filters,
                                           #   inline "mark internalized" two-step confirm)
    course/                               # AttachmentsPanel, KcTypeBadge, MasteryBar, PlayPanel (v1.7: gains an
                                           #   "Understand" link per KC row), PracticePanel, ResourceTile, StatusChip;
                                           #   v1.8 course-home rebuild: CourseHome (island), CourseTasks,
                                           #   UnderstandNext, UpNextCard, GradeStatCard
    dashboard/                            # CourseCards, DeadlinesList, RecordEventCard, TodayTasks, WeekView
                                           #   (v1.8: collapsed chips get the shared planner hover card + open
                                           #    EventPopover in place instead of deep-linking to /planner)
    events/                               # EventTimeline.svelte, LogEventModal.svelte
    feed/                                 # ResourceCard (favicon tiles), ShareResourceForm, StudySessionStub
    learn/                                # v1.7: /learn/[kcId]'s 4-stage flow — PrereqGraph (layered, BFS depth),
                                           #   VerifyQuiz, InterestRanker (tap-to-rank -> focus_order), AbsorbFlow
                                           #   (wraps ScaffoldChat, mode: 'absorb'), types.ts
    notes/                                # NotesList, NoteEditor, LinkPicker
    onboarding/                           # OnboardingFlow.svelte
    planner/                              # PlannerView, WeekGrid, CalendarGrid, AgendaList, EventPopover,
                                           #   CreateSessionPopover, PlannerRail
      event-popover/                      #   EventPopover's parts: EventSummary (read-only), TaskDueToggle,
                                           #   SessionReschedule, ClassSessionActions, EventActions (links +
                                           #   delete). One mutation each; only the shell writes to `item`.
    settings/                             # AppearanceSettings.svelte, TaskGeneratorSettings.svelte
    shell/                                # AddCourseModal, AvatarMenu, BottomNav (mobile tab bar),
                                           #   CourseContextSetter, Header, HeaderActions, Icon, NotificationsBell,
                                           #   popover.svelte.ts, ScratchpadPopup, Sheet (mobile bottom-sheet
                                           #   primitive), Sidebar, ThemeScript, Toast, TodoDropdown
    standing/                             # Cards reused by the course Overview: AssessmentsCard, AttendanceCard,
                                           #   MasteryCard, PracticeCard, RecentActivityCard
                                           #   (StandingTab/TasksCard/DeadlinesCard retired in the v1.8
                                           #    task-oriented course-home rebuild — see components/course/)
    study/                                # StudyFlow.svelte
    tasks/                                # TaskItem, TaskTypeIcon, TasksView, TaskCheckbox (checkbox delight +
                                           #   confetti), CompletionFlow (typed-task completion dialog),
                                           #   TaskQuickActions (v1.8: hover/focus-revealed icon cluster —
                                           #   snooze/delete/log-practice; ⋯ disclosure on coarse pointers)
    tutor/                                # ScaffoldChat (v1.7: scans every fenced block per message, not just
                                           #   the first, so a turn can carry interactive_model AND
                                           #   correction_proposal), InteractiveModel, QuickQuiz
  pages/
    404.astro
    login.astro, sign-in/[...path].astro, sign-up/[...path].astro, account/[...path].astro
    index.astro, onboarding.astro, dashboard.astro
    calendar.astro                        # 302 redirect → /planner (kept alive for old links/bookmarks)
    grades.astro, feed.astro, planner.astro, profile.astro, settings.astro, tasks.astro
    study.astro, study/quiz.astro
    tutor/[kcId].astro
    learn/[kcId].astro                     # v1.7: the absorb-experience 4-stage flow (see components/learn/)
    corrections.astro                     # v1.7: the corrections-ledger page (CorrectionsLedger.svelte)
    notes/index.astro, notes/[id].astro
    courses/
      index.astro
      [slug]/index.astro, [slug]/concepts.astro, [slug]/notes.astro, [slug]/resources.astro,
      [slug]/practice.astro, [slug]/play.astro, [slug]/kc/[kcId].astro
    api/v1/
      auth/login.ts, auth/logout.ts       # explicit 410 auth_retired responses
      user/index.ts
      courses/index.ts, courses/[id]/assessments.ts, courses/[id]/attachments.ts,
        courses/[id]/class-sessions.ts, courses/[id]/practice-summary.ts, courses/[slug].ts
      kcs/[id]/index.ts, kcs/[id]/events.ts, kcs/[id]/graph.ts, kcs/[id]/misconceptions.ts,
        kcs/[id]/scaffolds.ts               # v1.7: knowledge-graph traversal + scaffold/misconception reads
      corrections/index.ts, corrections/[id]/index.ts   # v1.7: the corrections-ledger CRUD
      events/index.ts, events/[id].ts
      assessments/[id].ts
      class-sessions/[id].ts
      calendar/index.ts
      grades/summary.ts
      tasks/index.ts, tasks/[id].ts
      notes/index.ts, notes/[id].ts
      resources/index.ts, resources/[id].ts
      attachments/[id].ts
      sessions/index.ts, sessions/[id].ts, sessions/[id]/complete.ts
      notifications/index.ts, notifications/count.ts, notifications/read-all.ts, notifications/[id]/read.ts
      profile/index.ts
      tutor/conversations/index.ts, tutor/conversations/[id]/index.ts,
        tutor/conversations/[id]/messages.ts, tutor/conversations/[id]/end.ts
      runtime/snapshot.ts                 # authenticated browser projection of the caller's learner DO
      flows/quick_quiz/index.ts, flows/quick_quiz/[id]/answers.ts

tests/                                    # Flat layout (no unit//integration split — that was never built)
  audit-grades-perf, audit-lifecycle, audit-notifications, audit-ownership, audit-schema-bounds,
    audit-sweep, audit-uploads (.test.ts)  # Targeted regression suites from security/perf/lifecycle audits
  auth, calendar, classSessions, corrections, course-content, courses-create, events, grades,
    knowledgeMap, mastery, middleware, notifications, practiceSummary, quick-quiz, serialize, session,
    sessions, stores-tasks, tasks, tasksStoreSelectors, taskSweep, tutor-conversations, tutor-list,
    tutor-modelSpec, tutor-openrouter (.test.ts)
  env.d.ts
  routes/
    assessments.test.ts, assessmentsKcs.test.ts, assessmentsKind.test.ts, events.test.ts, tasks.test.ts
  setup/
    apply-migrations.ts
  smoke/
    api-contract.test.ts

docs/
  README.md (this map)
  product/
    vision.md, user-journeys.md, screens.md, student-lifecycle.md (mermaid lifecycle diagrams)
  architecture/
    overview.md (this file), data-model.md, events-and-mastery.md (KLI distillation), tutor.md, cloudflare.md,
    agentic-channels.md
  design/
    charter.md                           # Binding cross-theme contract (shared structure vs. per-theme tokens)
    compass.md, focus.md, campus.md      # Per-theme voice/type/color/density/motion rationale
    planner-ux.md                        # Planner spec (week grid default, popovers, deep links)
    mobile-shell.md                      # Mobile shell contract (bottom nav, sheets, per-page reorders)
  api.md (FROZEN v1, M1 — additive sections through v1.4)
  decisions/
    ADR-001-astro-ssr-on-cloudflare.md, ADR-002-svelte.md, ADR-003-d1-drizzle.md,
    ADR-004-event-sourced-mastery.md, ADR-005-hand-rolled-sessions.md, ADR-006-r2-uploads.md
  todo.md
```

## Local Development

```bash
# Setup (Node >= 22.12 — see .nvmrc)
npm install
cp .dev.vars.example .dev.vars          # Add OPENROUTER_API_KEY
npm run db:migrate:local
npm run db:seed                         # Idempotent: courses.json → D1

# Dev server
npm run dev                             # Astro on workerd, hot-reload

# Tests
npm test                                # Vitest with pool-workers

# Type checking (run before committing)
npm run check                           # wrangler types + astro check

# Layout regression guard (needs a running dev server)
npm run check:layout                    # scripts/layout-check.cjs
```

`npm run deploy` performs a local production build followed by `wrangler deploy`. CI/CD, environment promotion, and rollback automation are still tracked in `docs/todo.md`.

### Type checking

`npm run check` regenerates the Cloudflare `Env` types (`wrangler types` → `worker-configuration.d.ts`, gitignored, regenerate whenever `wrangler.jsonc` bindings change) and then runs `astro check` (which also covers `.ts`/`.svelte` files, not just `.astro`). `src/env.d.ts` augments the generated global `Cloudflare.Env`/`Env` with `OPENROUTER_API_KEY` (a secret set via `.dev.vars`/`wrangler secret put`, not a `wrangler.jsonc` var, so wrangler's generator doesn't know about it). There are no git hooks wired up — run `npm run check` yourself before committing; CI wiring is tracked in `docs/todo.md`.

As of 2026-08-24, `npm run check:types` reports zero errors. Treat command output as authoritative rather than preserving old transient diagnostics here.

### Layout regression guard

`scripts/layout-check.cjs` is an assertion-based Playwright script (no screenshots) that logs in and checks layout invariants across a viewport × sidebar-state matrix, so a regression in the container/breakpoint math fails fast instead of waiting for a human to notice a squished page. It checks, per page: no horizontal page overflow, the main content column staying centered with equal gutters once it's narrower than its container, and no element bleeding past the viewport's right edge; on `/dashboard` specifically, that the rail (320px column) goes side-by-side vs. stacks based on the actual measured container width vs. the `@container` breakpoint read live out of `dashboard.astro`; and that each of the 4 header popovers stays fully on-screen when opened. Pages covered: dashboard, feed, planner, tasks, notes, profile, `/corrections` and a `/learn/[kcId]` route (v1.7), and a course's overview/concepts/resources tabs, at widths 1440/1280/1024/820 in both sidebar states.

Like `visual-qa.mjs`, it needs Playwright under Node 20 (see the comment header in the script for the exact `NODE_PATH` invocation) and a running dev server — pass the base URL as an argument or via `LAYOUT_CHECK_BASE_URL`.

**Regression guards**: the CONFIG block at the top of the script (content-max, sidebar widths, breakpoints, viewport list) mirrors current values in `tokens.css`/`AppShell.astro`/`dashboard.astro` — update it there first if you intentionally change one of those. A `pendingRebaseline` list marks checks that are allowed to fail without breaking the exit code, for layout under active rework elsewhere; when that work lands, remove the relevant entries and confirm the checks pass for real rather than leaving them pending indefinitely.

### Visual QA

`scripts/visual-qa.mjs` drives Playwright against a running dev server and captures JS console/page errors along the way. Scope: the full 3-theme × 2-scheme matrix on the four pages most sensitive to token changes (dashboard, a course page, planner, settings); every other page (courses, concepts, notes, resources, practice, play, feed, tasks, notes-index, profile) single-pass at compass/light; interaction-state shots (notifications/todo/scratchpad/avatar popovers, record-event and add-course modals, planner's EventPopover + month-view switch); the feed masonry reflow at two viewport widths; and sidebar-collapsed + narrow-viewport passes. The review workflow — parallel reviewer agents, triage discipline, known gotchas (Vite deps-cache corruption, truncated-HTML-as-island-SSR-crash) — is documented in `.claude/skills/visual-qa/SKILL.md`. Run it after any UI change.

## TODO

- Repository initialization checklist (TypeScript setup, ESLint, Prettier, git hooks).
- Detailed dev environment setup guide (Node version, wrangler config, local D1).
- CI/CD pipeline definition (GitHub Actions for test, lint, deploy).
- Performance budgets and monitoring strategy.
