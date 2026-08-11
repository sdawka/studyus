# StudyBuddy Screen Inventory

All pages wrapped in `AppShell.astro` with a two-group sidebar (Admin: Dashboard / Calendar / Grades; Learning: Feed / Courses / Study / Notes / Tasks / Profile). Global "Record event" modal in nav. `*` marks Svelte islands.

| Route | Purpose | Key Components |
|---|---|---|
| `/login` | Session login | LoginForm* |
| `/` | Redirect → onboarding or dashboard | (redirect logic in middleware) |
| `/onboarding` | 4-step stepper (skippable): what StudyBuddy is (admin + learning sides) → how KCs/events → mastery works, in plain language → confirm the imported courses → set display name + current term (`PATCH /user`, stamps `onboarded_at`). Personalized pacing/goals shown as a visible, disabled "coming soon" item. | OnboardingFlow* |
| `/dashboard` | 7-day calendar strip, grade snapshot, due tasks, quick event log | CalendarStrip*, GradeSnapshot*, TasksWidget*, EventLog |
| `/calendar` | Month + agenda views, **course filter dropdown**, scoped to current term by default | CalendarView* |
| `/grades` | Assessments, weights, current standing, grade entry | GradeTable*, GradeEntryForm* |
| `/feed` | Curated + user-shared resources, course filter, add-resource form, study-session-organizer stub | ResourceList*, AddResourceForm*, CourseFilter* |
| `/courses` | Course cards with mastery bars, grouped by term (current term first) | CourseCard*, TermGroup |
| `/courses/[slug]` | Tabs: Standing (default), Concepts, Notes & Uploads, Resources | StandingTab, ConceptsTab, NotesTab, ResourcesTab |
| `/courses/[slug]` Standing tab | Weighted grade standing from entered grades, assessment list w/ inline grade entry, attendance record (% + one-tap log), mastery summary per branch, upcoming deadlines, recent events (edit/delete for manual) | GradeStandingView, AssessmentList*, AttendanceRecord*, BranchMastery*, DeadlinesWidget, EventTimeline* |
| `/courses/[slug]/kc/[kcId]` | Mastery history, event timeline, linked notes/resources, "Tutor me" | KCHeader, MasteryChart*, EventTimeline*, LinkedNotes, LinkedResources, TutorButton |
| `/study` | Pick course → duration → event type → timer → completion → appends events | CourseSelect*, DurationInput*, EventTypePicker*, Timer*, CompletionForm* |
| `/tutor/[kcId]` | Scaffold chat* (SSE) or InteractiveModel* per kc_type | ScaffoldChat*, InteractiveModel* |
| `/notes` | NoteList, markdown editor | NoteList*, NoteEditor* |
| `/notes/[id]` | Markdown NoteEditor with course/KC LinkPicker | NoteEditor*, LinkPicker* |
| `/tasks` | TaskList with due dates + course links | TaskList*, TaskForm* |
| `/profile` | Overall mastery + streaks, per-course mastery bars, KC status distribution (counts by not-started/learning/review/mastered), recent-events timeline, and a clearly-stubbed "Global knowledge map — coming later" panel (informational sketch, no fake data) | MasteryBar (per course), EventTimeline*, knowledge-map sketch |

## Shared Components

- **RecordEventModal*** — Global modal for logging lectures, grades, readings (accessible from any page via nav icon).
- **AppShell.astro** — Layout wrapper with sidebar, nav, footer.
- **SessionMiddleware** — `src/middleware.ts` gates pages and `/api/v1` routes; redirects unauthenticated users to `/login`.

## TODO

- Detailed component APIs (props, events, internal state management).
- Design system / component library documentation.
- Wireframes or mockups for key screens (onboarding, study, tutor).
