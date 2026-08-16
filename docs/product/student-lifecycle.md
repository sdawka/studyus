# Student Lifecycle in studyus

This doc traces the situations a student moves through over a term and which studyus surface serves each one. It assumes the KLI ontology from `docs/architecture/events-and-mastery.md` (KCs, dual-role instructional/assessment events, the mastery fold) and the entry points from `docs/product/user-journeys.md` — read those first if a diagram here seems to skip a step. Diagrams are GitHub-native `mermaid` fences; nothing else in this repo renders mermaid today, so this doc establishes the convention.

## Overview: The Full Loop

Onboarding happens once. After that, the student's time is organized by a fast daily/class-meeting rhythm (before → in → after class), a slower weekly planning cadence, periodic intensification before each exam, and a reflection step after each grade posts. All of it feeds — and is fed by — one continuous mastery loop running underneath. The cadences differ (class meetings happen several times a week, planning weekly, exams periodically, mastery continuously); this diagram is a narrative arc through them, not a strict pipeline.

```mermaid
flowchart TD
    A["Onboarding<br/>(once)"] --> B
    subgraph rhythm["Class rhythm (repeats per class meeting)"]
        B["Before class<br/>prep_before_class task"] --> C["In class<br/>attendance + optional event log"]
        C --> D["After class<br/>review_after_class task"]
        D --> B
    end
    D --> E["Weekly planning<br/>Planner + dashboard week view"]
    E --> F["Before an exam<br/>practice_kc tasks intensify"]
    F --> G["After grades come back<br/>grade entry, standing update"]
    G --> H["Long-run mastery loop<br/>event fold, spaced review"]
    H --> E
```

A ninth situation — **absorbing a new KC** (§9, v1.7) — runs orthogonally to this cadence rather than slotting into one point on it: a student can reach for it any time they want to actually *understand* a topic (not just drill it), triggered by curiosity, an upcoming exam, or a KC flagged not-yet-`ready` during another absorb session's own prerequisite check. It feeds into the same long-run mastery loop (§8) as everything else — an absorb conversation still appends a `tutor_session` event on close.

## 1. Onboarding

A first-time sign-in walks the student from an empty account to a personalized, populated workspace. The goal is confidence in what a "knowledge component" is and a workspace pre-loaded with their real courses, not a blank slate. Surfaces: `OnboardingFlow` (Svelte stepper), the seeded `courses/courses.json` catalog, and the background sweep that turns a confirmed course list into a working calendar.

```mermaid
flowchart TD
    A["Sign in<br/>POST /auth/login"] --> B{"onboarded_at set?"}
    B -->|"no, first time"| C["Step 1: what studyus is"]
    B -->|"yes, returning"| H["Dashboard"]
    C --> D["Step 2: how mastery is modeled"]
    D --> E["Step 3: confirm imported courses<br/>(courses/courses.json, grouped by term)"]
    E --> F["Step 4: display name + current term<br/>PATCH /user, stamps onboarded_at"]
    F --> I["Background sweep populates<br/>class_sessions + system tasks"]
    I --> H["Dashboard<br/>empty calendar, quick tips"]
```

## 2. Before Class

The gap before a scheduled class meeting; the goal is to walk in prepared rather than cold. The sweep's `prep_before_class` generator surfaces the same task across every checkable-task surface, and the student closes the loop on a course's Notes/Resources tabs.

```mermaid
flowchart TD
    A["Sweep generates<br/>prep_before_class task"] --> B["TodayTasks<br/>(dashboard hero)"]
    A --> C["/tasks<br/>per-course card"]
    A --> D["Header TodoDropdown<br/>(quick capture, any page)"]
    B --> E["Student reviews course<br/>Notes / Resources tabs"]
    C --> E
    D --> E
    E --> F["Marks prep_before_class task done"]
```

## 3. In Class: Attendance vs. Mastery Credit

Attendance bookkeeping and mastery credit are **two independent mechanisms** — a consistency point worth being explicit about. The sweep pre-generates a `class_sessions` row per scheduled meeting day (from `courses.meeting_days`), and marking it `attended`/`missed` on the course's Standing tab (`AttendanceCard`) two-way-syncs the linked `attend_class` task. Separately, and optionally, the student can log a `lecture_attended`/`lecture_missed` event via the header's Record Event modal (with an optional KC link) — this is the path that actually feeds the mastery fold. Marking a session attended does not append an event, and logging an event does not touch `class_sessions` or the task.

```mermaid
sequenceDiagram
    participant Sweep
    participant CS as class_sessions row
    participant Student
    participant AC as AttendanceCard (Standing tab)
    participant EL as Event log
    participant MF as Mastery fold

    Sweep->>CS: pre-generate row (status null) + linked attend_class task
    Note over CS: Bookkeeping path
    Student->>AC: mark attended or missed
    AC->>CS: update status, sync attend_class task both ways
    Note over Student,MF: Separate, optional path for mastery credit
    Student->>EL: log lecture_attended/missed via Record Event modal (optional KC link)
    EL->>MF: foldMastery re-runs (is_instructional=true)
    Note over CS,MF: Marking attendance never appends an event —<br/>logging an event never touches class_sessions
```

## 4. After Class

The consolidation window right after a lecture: capture what happened, then optionally start turning it into mastery credit. The sweep's `review_after_class` task anchors this; notes/resources capture and the Record Event modal cover the rest. Completing the task runs through the typed-task completion flow (recap, notes, follow-ups) and the task lands in the "Ta-Da" completed tab.

```mermaid
flowchart TD
    A["Sweep generates<br/>review_after_class task"] --> B["Student engages:<br/>scratchpad note, course Notes/Resources"]
    A --> C["Optionally logs a completed<br/>reading/video/tutoring event<br/>via Record Event modal"]
    C --> D["Event appended,<br/>feeds mastery fold for linked KC"]
    B --> E["Marks review_after_class task done"]
    D --> E
    E --> F["Completion flow captures<br/>recap + notes + follow-ups"]
    F --> G["Task moves to<br/>Ta-Da completed tab"]
```

## 5. Weekly Planning

The step-back view: what's due, what's scheduled, and where to slot study time this week. `/planner`'s unified calendar (week grid by default, toggleable to month/agenda) is the hub; the dashboard's `WeekView` widget mirrors it in miniature. `PlannerRail` surfaces unscheduled due-soon items but — per `docs/todo.md`'s deferral list — clicking one only jumps the grid to that week, it doesn't auto-schedule; scheduling itself now happens by dragging directly on the grid to create a typed item (class / study session / other).

```mermaid
flowchart TD
    A["Student opens Planner<br/>(week grid default)"] --> B["Unified calendar: assessment due-dates,<br/>task due-dates, sessions, logged events"]
    A2["Dashboard WeekView widget"] --> B
    B --> C["PlannerRail: due-soon<br/>unscheduled items"]
    C -->|"click"| D["Jumps grid to that item's week<br/>(view only, no auto-schedule)"]
    B -->|"click empty grid space"| E["Drag-to-create a typed item:<br/>class / study session / other"]
    E --> F["New item appears on calendar<br/>+ dashboard WeekView"]
    B -->|"click an item"| G["EventPopover<br/>view/edit"]
```

## 6. Before an Exam

As an assessment's due date approaches, review sharpens toward the KCs it actually covers. The `practice_kc` sweep generator ties an ungraded assessment to its lowest-mastery linked KCs (via `assessment_kcs`, the "Concepts covered" picker on `AssessmentsCard`) and the student works them through the course's Practice or Play tab, with the tutor's mode chosen by `kc_type` rather than by mastery level.

```mermaid
flowchart TD
    A["Assessment due date approaches<br/>(assessment_kcs linkage exists)"] --> B["Sweep generates practice_kc tasks<br/>for the assessment's weakest linked KCs"]
    B --> C["Course Practice tab<br/>StudyFlow / QuickQuiz"]
    B --> D["Course Play tab<br/>concept/principle KCs"]
    C --> E["Tutor mode by kc_type:<br/>recall or worked_example"]
    D --> F["Tutor mode by kc_type:<br/>classify, self_explain, interactive_model"]
    E --> G["Events appended,<br/>mastery fold recomputes"]
    F --> G
    G --> H["Concepts tab shows<br/>updated status before the exam"]
```

## 7. After Grades Come Back

A grade posts, and three things follow from one action: the linked `grade_entry` task auto-completes, the course's weighted standing (official assessments only) recalculates, and — this is the subtlety — the mastery fold updates only because grade entry fans out into one assessment event *per linked KC* at write time. `assessment_kcs` decides which KCs get an event here; `foldMastery` itself still only ever reads `events.kc_id`, never `assessment_kcs` directly, so this doesn't contradict the "unconsumed `qmatrix_version`" note in `docs/architecture/events-and-mastery.md`. Grade entry works the same way whether it comes from the course Overview's inline entry or the header's Record Event modal — both funnel through `PATCH /assessments/:id`.

```mermaid
sequenceDiagram
    participant Student
    participant Overview as Course Overview (AssessmentsCard)
    participant Task as grade_entry task
    participant Events as Event log
    participant Standing as Weighted standing
    participant Mastery as Mastery fold

    Note over Task: Sweep pre-generated this task<br/>when the assessment came due, ungraded
    Student->>Overview: enter grade (grade_received)
    Overview->>Events: append one assessment event per KC<br/>linked via assessment_kcs (quiz_taken/assignment_graded/exam_graded)
    Overview->>Task: auto-complete grade_entry task
    Overview->>Standing: recalc weighted grade (official assessments only)
    Events->>Mastery: foldMastery re-runs per KC (events.kc_id)
    Note over Events,Mastery: assessment_kcs only decides which KCs get an event here —<br/>the fold itself only ever reads events.kc_id
```

## 8. The Long-Run Mastery Loop

Underneath every situation above, the same fold is always running: every instructional/assessment event re-runs `foldMastery` for its KC, and the result decides both what the tutor does next and what the sweep resurfaces. Tutor mode is selected by `kc_type`, not by mastery status — a `fact` KC always gets spaced retrieval regardless of where its mastery sits.

```mermaid
flowchart TD
    A["Instructional + assessment events<br/>accumulate (dual-role flags)"] --> B["foldMastery re-runs on every<br/>event create/edit/delete"]
    B --> C["AE component:<br/>recency-weighted success average"]
    B --> D["IE bump:<br/>capped exposure credit"]
    C --> E["Combined raw score"]
    D --> E
    E --> F["Idle decay toward floor<br/>since last event of any kind"]
    F --> G["Status: learning / review / mastered"]
    G --> H["stale_kc sweep flags KCs<br/>due for spaced review"]
    G --> I["Tutor mode selected by kc_type,<br/>not by mastery status"]
    H --> J["Student practices<br/>(Practice / Play / tutor)"]
    J --> A
```

## 9. Absorbing a New KC (Guided Understanding)

Distinct from the class-meeting rhythm above: any time a student wants to *understand* a KC rather than just drill it, they can absorb it. The raw material comes from `courses/<slug>/content.json` (frozen contract: `courses/content-schema.md`), seeded across all 9 current-term courses: 147 KCs (all five KLI types represented — e.g. CHEE 314 alone has 1 fact, 5 concept, 7 rule, 4 principle, and 1 association KC), 187 prerequisite edges (`kc_edges`) including cross-course chains — CHEE 314's "Dimensional analysis and the Buckingham Pi theorem" is itself a prerequisite for two CHEE 315 KCs, and CHEE 314's "Bernoulli equation" requires a MATH 264 calculus KC first — 297 scaffolds (worked examples, retrieval prompts, and 9 other KLI-grounded kinds; `rule` KCs like Buckingham Pi get a full support-fading ladder, the same worked example at levels 1→2→3), and 42 misconceptions with a diagnostic probe and a standalone corrected statement each (e.g. Bernoulli's equation has two documented ones, grounded in physics-education-research literature, not guessed).

Entry point: <!-- pending #49 -->.

```mermaid
flowchart TD
    A["Student picks a KC to absorb<br/>(entry point pending #49)"] --> B["POST /tutor/conversations<br/>mode: 'absorb'"]
    B --> C["GET /kcs/:id/graph<br/>traverses kc_edges"]
    C --> D{"Any prereq<br/>not yet ready?<br/>(engaged-with AND<br/>mastery >= review threshold)"}
    D -->|"yes"| E["Tutor addresses the prereq first<br/>(optionally a targeted quick_quiz<br/>scoped to just that KC)"]
    E --> D
    D -->|"all ready"| F["Tutor teaches the target KC<br/>via its matched scaffolds<br/>(kind chosen by KLI kc_type)"]
    F --> G{"Diagnostic probe reveals<br/>a known misconception?"}
    G -->|"yes"| H["Tutor proposes a correction<br/>(correction_proposal block)"]
    H --> I{"Student accepts?"}
    I -->|"accept"| J["POST /corrections<br/>logged to the ledger, status: active"]
    I -->|"dismiss"| F
    G -->|"no"| K["Conversation ends —<br/>tutor_session event appended"]
    J --> K
    K --> L["Mastery fold re-runs<br/>(feeds §8's long-run loop)"]
    J --> M["correction_review sweep:<br/>reminds every ~14 days<br/>until marked internalized"]
```

The corrections ledger is a first-class, revisitable asset — "things I used to believe and have corrected" — not a line buried in a chat transcript. A correction stays `active` (and keeps getting the spaced reminder) until the student marks it `internalized`.

## Planned Extensions (Not Yet Shipped)

Two surfaces would extend this lifecycle but aren't built: **Flue agentic channels** (a bus-quiz flow over Telegram/SMS, letting practice happen off-app — fully specced in `docs/architecture/agentic-channels.md`, post-v1 experimental) and an **iPad client** (native app reusing the frozen API contract). Neither is reachable in the app as of 2026-08-15.
