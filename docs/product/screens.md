# studyus Screen Inventory (v1.1)

Every page renders inside `AppShell.astro` — a two-column grid: a collapsible **Sidebar** (Home, current-term courses with hue tints, "+ Add course", past-terms `<details>`, footer Feed/Settings/collapse toggle) and a sticky **Header** (56px; a center slot for course tabs/breadcrumbs, and a right-hand cluster: Record Event pill, scratchpad popup, todo dropdown, notifications bell, avatar menu). `ThemeScript.astro` stamps `data-theme`/`data-scheme`/`data-sidebar` on `<html>` pre-paint from `localStorage`, mirrored server-side from `users.settings`. `*` marks Svelte islands.

| Route | Purpose | Key Components |
|---|---|---|
| `/login` | Session login | LoginForm* |
| `/` | Redirect → onboarding or dashboard | (redirect logic in middleware) |
| `/onboarding` | 4-step stepper (skippable): what studyus is → how mastery is modeled → confirm imported courses → set display name + current term (`PATCH /user`, stamps `onboarded_at`) | OnboardingFlow* |
| `/dashboard` | Campus-style composition: page head (kicker date·term·week, conversational h1) → main column (WeekStrip, GradeSnapshot, CourseMiniGrid) + rail (RecordEventCard, DueList with urgency pills) | WeekStrip, GradeSnapshot, CourseMiniGrid, RecordEventCard, DueList |
| `/planner` | Full-viewport modal layer over AppShell (scrim + near-fullscreen panel; Escape/close → back or `/dashboard`) with calendar grid + agenda list, course-hue chips | PlannerView*, CalendarGrid*, AgendaList* |
| `/calendar` | 302 redirect → `/planner` (kept alive for old links/bookmarks) | — |
| `/courses` | Course cards grouped by term (current term first), grouped by mastery/status; archived courses collapsed in an "Archived" `<details>` section below | MasteryBar |
| `/courses/[slug]` | `CourseLayout.astro` renders the course head + 6-tab bar (underline style, `aria-current`) | CourseLayout |
| `/courses/[slug]` (Overview) | Weighted grade standing, assessment list w/ inline grade entry, attendance record, mastery summary per branch, upcoming deadlines, recent events | StandingTab, AssessmentList*, EventTimeline* |
| `/courses/[slug]/concepts` | Branch/KC tree with mastery bars, KC detail link | — |
| `/courses/[slug]/notes` | Linked notes + AttachmentsPanel; notes saved from the header scratchpad to this course also land here | NotesList*, AttachmentsPanel* |
| `/courses/[slug]/resources` | Canonical/feed/user-shared resource groups + this course's feed section | ResourceCard |
| `/courses/[slug]/practice` | Drills island: StudyFlow (preselected to this course, skips the course-pick step) + QuickQuiz + links to recall/worked-example tutor for fact/rule KCs | StudyFlow*, QuickQuiz* |
| `/courses/[slug]/play` | Exploratory island: lists the course's principle/concept KCs → interactive-model/self-explain tutor conversations, with history via `GET /tutor/conversations?course=` | ScaffoldChat*, InteractiveModel* |
| `/courses/[slug]/kc/[kcId]` | Mastery history, event timeline, linked notes/resources, "Tutor me" | MasteryChart*, EventTimeline*, TutorButton |
| `/study`, `/study/quiz` | Kept alive, unlinked — functionality absorbed into course Practice tabs | StudyFlow*, QuickQuiz* |
| `/notes`, `/notes/[id]` | Kept alive, unlinked from the sidebar (replaced by the header scratchpad popup for quick capture); full editor still reachable via a note's "open full editor" link | NoteList*, NoteEditor* |
| `/tasks` | TaskList with due dates + course links; also surfaced as a header dropdown (top ~7, add-task inline) | TaskList*, TaskItem* |
| `/feed` | Curated + user-shared resources, course filter, add-resource form | ResourceCard*, ShareResourceForm* |
| `/grades` | Kept alive, unlinked — content absorbed into dashboard + course Overview | GradeTable* |
| `/profile` | Overall mastery + streaks, per-course mastery bars, KC status distribution, recent-events timeline, stubbed "Global knowledge map — coming later" panel | MasteryBar, EventTimeline*, knowledge-map sketch |
| `/settings` | Theme (compass/focus/campus) + scheme (light/dark/system) pickers, display name/current term, logout | AppearanceSettings* |

## Shell components

- **Sidebar.astro** — brand, Home, current-term courses (two-line code+title, hue-tinted left rail when active), "+ Add course" (always visible), past-terms `<details>`, footer (Feed, Settings, collapse toggle). Collapses to a 60px rail of monogram chips, persisted via `localStorage`/`settings.sidebar_collapsed`.
- **HeaderActions.svelte** — island composing the Record Event pill (opens `LogEventModal`), `ScratchpadPopup` (saves a note to general or a specific course), `TodoDropdown`, `NotificationsBell` (60s visibility-aware poll), `AvatarMenu` (Profile/Settings/Logout).
- **CourseLayout.astro** — wraps `AppShell`, renders the course head + 6-tab bar for all `/courses/[slug]/*` subroutes.
- **AddCourseModal.svelte** — triggered from the sidebar's "+ Add course" button (and the dashboard empty-state) via a `window` CustomEvent; posts to `POST /courses`.
- **SessionMiddleware** — `src/middleware.ts` gates pages and `/api/v1` routes; redirects unauthenticated users to `/login`.

## TODO

- Detailed component APIs (props, events, internal state management).
- Design system / component library documentation beyond `docs/architecture/overview.md`'s tokens section.
- Wireframes or mockups for key screens (planner, Play tab interactive models).
