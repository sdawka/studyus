# studyus User Journeys

**Re-derived 2026-08-24 against the current Clerk middleware, routes, and components.** “Current” below means reachable behavior in the working app. The onboarding contract and its explicit follow-ups live in `docs/product/onboarding.md`.

> For the full term-long lifecycle as diagrams — before/in/after class, weekly planning, pre-exam practice, post-grade reflection, and the mastery loop — see `docs/product/student-lifecycle.md`.

## Current First-Time User Path

1. **Try it publicly** at `/try`. Three skippable setup sections create a browser-local shadow workspace, followed by nine interactive university-life situations. No account is required and simulated evidence stays simulated.
2. **Authenticate with Clerk** at `/sign-in` or `/sign-up`. A trial sign-up returns to `/onboarding?import=demo`; middleware resolves the verified Clerk identity to immutable local `users.id`.
3. **Confirm import or start fresh.** The learner sees the exact context, preferences, and real course proposal eligible for import. Demo scores, scenarios, tasks, and grades are excluded.
4. **Create the first useful course.** Choose a reviewed McGill template, manually enter topics, or locally extract suggestions from PDF/DOCX/text/Markdown. The learner reviews the proposed map before commit.
5. **Enter the product only with usable content.** Middleware redirects unfinished or legacy-empty learners to `/onboarding`. Completion requires one active, non-archived course with a meaningful KC, and the learner lands on that course overview.

## Returning User: Sidebar Entry Points

The desktop sidebar (`Sidebar.astro`) offers three persistent entry points above the course list — Home, Tasks, and (in the footer) Feed — each leading to a different workflow. `/study` is **not** one of these: it's kept alive and reachable by direct URL but unlinked from any nav, its functionality absorbed into each course's Practice tab (`/courses/[slug]/practice`) — see `docs/product/screens.md`.

### Door 1: Dashboard (Status Check)
- **Route**: `/dashboard`
- **Flow**: Task-centric hero (`TodayTasks` — overdue/today/next-7d buckets, checkable inline) leads, followed by the collapsible week strip (`WeekView`), slimmed course cards, and a rail with the record-event form and upcoming deadlines.
- **Use case**: "What do I need to do today? Any deadlines lurking?"

### Door 2: Feed (Unintentional Instruction)
- **Route**: `/feed`
- **Flow**: Browse the learner's private curated and user-added links in a Pinterest-style masonry grid, filtered by course chip. Search and cross-user/community sharing are not implemented.
- **Use case**: "I have 20 minutes. What's a good thing to read or watch right now?"

### Door 3: Tasks (Everything Checkable)
- **Route**: `/tasks`
- **Flow**: Per-course cards of open tasks (user todos and sweep-generated system tasks alike — attend-class, prep-before-class, practice-KC, etc.), one level of subtasks, inline quick-add. Also reachable without leaving the current page via the header's `TodoDropdown`.
- **Use case**: "What's actually due, and what has the app already lined up for me?"

### Door 4: Absorb (Guided Understanding) — v1.7
- **Route**: `/learn/[kcId]`. Entry points: an "Understand" link on each Concepts-tab KC row (`/courses/[slug]/concepts`), on KC detail (`/courses/[slug]/kc/[kcId]`, alongside the existing "Tutor me"), and on the Play tab's KC rows (`/courses/[slug]/play`).
- **Flow**, a 4-stage sequence:
  1. **Layered prereq map**: the target KC's prerequisites, grouped by hop distance (1, 2, 3... away), each marked ready or not-ready against the mastery review threshold. "Verify N weak prerequisites" or "Continue anyway." A leaf KC with no prerequisites skips straight to stage 4.
  2. **Verify**: a short quiz (`quick_quiz`, explicitly scoped to just the weak prerequisites) confirms — or corrects — the student's standing on them before moving on.
  3. **Interest ordering**: student taps to rank the KCs they're about to cover by what interests them most; the target KC is always tackled last.
  4. **Absorb chat**: an `absorb`-mode tutor conversation that teaches using the target KC's matched scaffolds (worked examples, retrieval prompts, derivation walkthroughs, etc. — chosen by the KC's KLI type) and watches for its documented misconceptions. A detected misconception surfaces as an inline accept/dismiss card; accepting logs it to the corrections ledger.
- **Use case**: "I want to actually understand this topic, not just drill it — and if I've got something backwards, help me see where the mix-up came from."

**Not a door**: `/study` and `/study/quiz` still work if visited directly (`StudyFlow`/`QuickQuiz`), but nothing in the shell links to them — the same drilling flow (pick course → timer → event type → reflect → append events) now lives inside each course's Practice tab instead, preselected to that course.

## Revisiting Corrected Beliefs (v1.7)

Accepting a tutor's correction during an absorb session doesn't just close out that turn of conversation — it creates a durable, per-user ledger entry (`user_corrections`): a specific wrong belief the student held, what they now understand instead, and when they accepted it. Framed for the student as "things I used to believe and have corrected," not an audit log.

- **Route**: `/corrections` — a dedicated page, not a panel bolted onto profile or settings. Active / Internalized / All filter tabs; each row shows the linked KC, the prior belief struck through, the correction text, and the accepted date.
- **Entry point**: the desktop sidebar's footer (next to Feed/Settings); on mobile, the avatar-menu sheet (next to Feed) — neither gets its own bottom-nav tab.
- An entry stays active — and keeps getting a spaced, roughly-14-day reminder notification (`correction_review`) — until the student marks it internalized (an inline two-step confirm on the ledger page), at the point they no longer need reminding.

## Recording Outside-App Events

A global "Record event" modal (in the header) lets you log anything, anywhere:
- Attended or missed a lecture (course-scoped, optional KC link).
- Got a grade on an assessment (appends dual-role assessment+event records).
- Completed a reading, video, tutoring session (manual event entry).

Use case: "I just took the midterm. Let me enter the grade so the standing updates."

## Admin Workflows (Planner, Grades, Attendance)

### Planner (`/planner`; `/calendar` is now a redirect here)
`/calendar` is a **302 redirect to `/planner`**, kept alive only for old bookmarks/links — there is no month-or-agenda page living at `/calendar` itself. `/planner` renders as a full-viewport overlay over the shell:
- Week time-grid view by default (per `docs/design/planner-ux.md`), toggleable to month or agenda via the same view switcher.
- **Course filter** (current-term / all courses / one course), scoped like the old dropdown.
- Shows assessment deadlines, scheduled/logged study sessions, and other course events; clicking an item opens its detail popover, clicking empty grid space opens an inline scheduled-session create form.

### Grades (`/grades` is kept alive, unlinked)
There is no standalone, nav-reachable grades page anymore — `/grades` still renders (`GradeTable`) but nothing links to it. The same information now lives in two places instead:
- **Dashboard**: course cards show a grade pill per course.
- **Course Overview** (`/courses/[slug]`): full assessments table with inline grade entry and a "Concepts covered" KC picker per assessment, below the fold. Since the v1.8 task-oriented rebuild the weighted standing is a compact rail stat card rather than the page hero — the fold belongs to what the student should *do* (To do, Understand next), not to how they're scoring.

### Attendance (`/courses/[slug]` Overview)
Attendance is **not** an ad hoc event-log button anymore. `class_sessions` rows are pre-generated by an idempotent sweep from each course's `meeting_days` (one row per scheduled meeting day, ±70 days back through today) with `status: null` (unmarked) until the student toggles it — `AttendanceCard` lists these and lets the student mark `attended`/`missed` per session, which updates the row's `status` directly (and, per the task-centric platform, syncs the linked `attend_class` task's completion both ways). Logging a `lecture_attended`/`lecture_missed` event manually (via the Record Event modal) still works for mastery-fold purposes, but is no longer how the Overview's attendance list itself gets populated or checked off.

## Future: Bus-Quiz Channel

The native per-learner Durable Object runtime is implemented for web tutor state. External channel identity/linking and channel adapters remain future work:
- **Bus quiz**: short MCQ on Telegram/SMS (via Durable Objects + channel router) given (course?, KC?, time budget). Generates N questions, grades, appends events.
- Other channels: WhatsApp, Discord, email digest.

*Runtime foundation and historical channel design: `docs/architecture/agentic-channels.md`.*

## TODO

- Implement the gated onboarding and course-ingestion contract in `docs/product/onboarding.md`.
- Study-session organizer (Feed view): allow batching multiple resources into a session plan.
- Reflection prompts: after study, after an assessment, weekly check-in.
