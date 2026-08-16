// TEMPORARY — docs annotation overlay content registry. See
// docs/product/annotations.md for the layer's lifecycle and retirement plan.
//
// This file is the machine-readable projection of docs/product/screens.md
// (plus docs/design/planner-ux.md, docs/design/mobile-shell.md,
// docs/design/charter.md, docs/api.md, docs/product/user-journeys.md, and
// docs/product/student-lifecycle.md) onto live DOM selectors. It exists so
// the runtime overlay (src/components/docs-overlay/) can badge a running
// page with "what is this, what can I do here, what actually happens"
// without a student ever seeing prose docs.
//
// THE RULE: if you change docs/product/screens.md's route table or a
// component's behavior, update the matching entry below in the same change.
// A Track D check script (see docs/product/annotations.md) asserts every
// `name` here matches screens.md's spelling exactly — do not rename a
// component here without renaming it there too.
//
// Conventions:
// - `name` is the component name exactly as screens.md spells it (asterisks
//   in screens.md mark Svelte islands at the doc level — they are NOT part
//   of the name string here).
// - `selector` is verified to resolve against the live SSR HTML at the time
//   this file was written (see per-entry notes below for anything that only
//   resolves after user interaction).
// - Arrays are alphabetized (by route, then by component name within a
//   route) so future diffs are additive, not reorderings.
// - Accuracy over volume: every claim here was checked against the actual
//   component source or a live curl, not guessed from the docs alone. Where
//   the docs and the code disagreed, the code won — see the inline note.

import type { Annotation, RouteAnnotation } from './types';

// ---------------------------------------------------------------------------
// Shared docs shorthand (just for readability below — not exported).
// ---------------------------------------------------------------------------
const SCREENS = 'docs/product/screens.md';
const PLANNER_UX = 'docs/design/planner-ux.md';
const MOBILE_SHELL = 'docs/design/mobile-shell.md';
const CHARTER = 'docs/design/charter.md';
const API = 'docs/api.md';
const JOURNEYS = 'docs/product/user-journeys.md';
const LIFECYCLE = 'docs/product/student-lifecycle.md';

// ---------------------------------------------------------------------------
// /courses/[slug] — Course Overview (v1.8 task-oriented rebuild)
// ---------------------------------------------------------------------------

const courseOverviewComponents: Annotation[] = [
  {
    // No distinct component file — CourseHome.svelte renders this inline as
    // a muted paragraph block (`.slot-about`), not an imported component.
    // Named to match the exact quoted phrase in screens.md rather than
    // invent a component name that doesn't exist in the code.
    name: 'About this course',
    selector: '.slot-about',
    purpose: "Reference material only — the course's free-text overview blurb, kept for context but deliberately sunk below every actionable card.",
    affordances: ['Read the course description entered at course-creation time.'],
    actions: ['Static server-rendered text — no interaction, no endpoint.'],
    feedback: ["Renders nothing at all when the course has no `overview` text (the whole slot is conditionally omitted, not shown empty) — see CourseHome.svelte's `{#if overview}` guard."],
    docs: [SCREENS, 'src/components/course/CourseHome.svelte'],
  },
  {
    name: 'AssessmentsCard',
    selector: '.slot-assessments',
    purpose: 'The reference ledger — every official and practice assessment, with inline grade entry and which concepts each one covers.',
    affordances: [
      'Enter/edit a grade received + grade max per official assessment inline in the table.',
      'Add a new assessment (official, with a weight %, or practice, with none) via "+ Add assessment".',
      'Pick "Concepts covered" — a KC multi-select chip picker — on add or edit, linking `assessment_kcs`.',
      'Mark a practice assessment "done" without a real score, or undo it.',
      'Edit an existing assessment\'s title/type/due date/weight/KC links.',
    ],
    actions: [
      'PATCH /api/v1/assessments/:id — grade entry, edit, and practice done/undo all funnel through this one endpoint with different bodies.',
      'POST /api/v1/courses/:id/assessments — add.',
      'GET /api/v1/courses/:slug (via courseContext) — lazily fetches the KC picker\'s options once, shared by add and edit forms.',
      'Saving a grade calls the parent island\'s onGraded callback, which refetches /api/v1/grades/summary and this course\'s assessments so Standing/Coming up stay in step.',
    ],
    feedback: [
      'Saving a grade shows an inline per-row message: "Saved — logged an event for linked KCs." when the write produced mastery deltas, plain "Saved." otherwise.',
      'A grade/edit/add failure surfaces its error inline in the form (not a toast) so it stays attached to the row being edited.',
      '"No official assessments yet." empty state; the practice group only renders at all once at least one practice assessment exists.',
      'At container width ≤480px the table remaps to a 2-row card grid per row instead of horizontal scroll (thead hidden).',
    ],
    docs: [SCREENS, API, 'src/components/standing/AssessmentsCard.svelte'],
  },
  {
    name: 'AttendanceCard',
    selector: '.slot-attendance',
    purpose: "Mark today's (or the most recent unmarked) class session attended or missed in one tap — attendance bookkeeping, not mastery credit.",
    affordances: [
      'One-tap "Attended" / "Missed" on the single actionable session (today\'s if unmarked, else the most recent past unmarked one).',
      'Add an optional note to that session.',
      'Set or edit which weekdays the course meets (first-run prompts for this before any sessions exist).',
      'Manually add a one-off class session (e.g. a makeup class) by date.',
      'Scan a 14-session dot strip of recent history (display-only).',
    ],
    actions: [
      'GET /api/v1/courses/:id/class-sessions?from=&to=&limit= — loads a ~60-day-back/14-day-forward window.',
      'PATCH /api/v1/class-sessions/:id — status (attended/missed) and/or note.',
      'PATCH /api/v1/courses/:id — meeting_days.',
      'POST /api/v1/courses/:id/class-sessions — add a one-off session.',
      'Marking status two-way-syncs the linked attend_class task server-side; the card calls refetchTasks() afterward so TodayTasks/TasksView/TodoDropdown all pick up the flip.',
    ],
    feedback: [
      'Optimistic status flip, rolled back on a failed PATCH (both failure modes — non-ok response or a dropped request — revert identically).',
      'The actionable row gets a warm "nudge" background tint when it\'s past-due and still unmarked.',
      '"All sessions marked — nice work." once nothing is left to mark.',
      'A percent stat ("N% · M of T marked") in the card head once at least one session exists.',
      'Attendance is bookkeeping only: it never appends an events-log row on its own — that\'s the separate, optional Record Event path (see student-lifecycle.md §3).',
    ],
    docs: [SCREENS, API, LIFECYCLE, 'src/components/standing/AttendanceCard.svelte'],
  },
  {
    // Two screens.md rows both name components for this route: the layout
    // wrapper row ("CourseLayout") and the Overview row (the ten `.slot-*`
    // cards above). This entry covers the wrapper — course identity + the
    // 6-tab switcher shared by all six /courses/[slug]/* subroutes, not just
    // the Overview tab.
    name: 'CourseLayout',
    selector: '.course-head',
    purpose: 'The course-scoped shell wrapping every /courses/[slug]/* subroute — course identity plus the 6-tab section switcher, so a student always knows which course and which tab they\'re in.',
    affordances: [
      'Read the course code, title, and term/instructor line.',
      'Switch between the 6 tabs (Overview/Concepts/Class notes/Resources/Practice/Play) via the underline-style tab bar.',
    ],
    actions: ['Plain <a> navigation between the six course subroutes — no writes.'],
    feedback: [
      'On mobile (≤767px) the tab strip becomes a horizontally-snapping, edge-faded row that auto-scrolls the active tab into center view on load.',
      // The 6-tab bar itself is a separate element (`.tab-bar`), rendered
      // via slot="header-center" into AppShell/Header.astro's center slot —
      // physically inside the Header shell annotation's own `.app-header`
      // region, not inside `.course-head`. `.course-head` (in `main`) is the
      // cleaner anchor for this component; `.tab-bar` was deliberately left
      // unselected here to avoid overlapping the Header badge.
      'The 6-tab bar itself (`.tab-bar`) renders inside the sticky header\'s center slot, not inside this element — see Header in SHELL_ANNOTATIONS.',
    ],
    docs: [SCREENS, MOBILE_SHELL, 'src/layouts/CourseLayout.astro'],
  },
  {
    name: 'CourseTasks',
    selector: '.slot-tasks',
    purpose: 'This course\'s hallway job — the same Overdue/Today/Next-7-days idiom as the dashboard\'s To do card, scoped to one course, so it\'s obvious what to do here right now.',
    affordances: [
      'Check off a task inline (typed tasks detour through the completion recap flow; plain todos complete instantly).',
      'Quick-add a task pre-scoped to this course via the input at the bottom.',
      'Snooze a system-generated task by a day, or delete it, via the row\'s hover/⋯ action cluster.',
      'Expand a quiet "Catch up" disclosure for past attend_class rows that never got marked.',
      'Jump to the full /tasks view, pre-filtered to this course, via "All tasks →".',
    ],
    actions: [
      'Reads/writes through the shared tasks store (src/lib/stores/tasks.ts) — toggleTask, addTask({course_ids:[courseId]}), snoozeTask, deleteTask — so a change here is instantly visible in TodoDropdown and vice versa.',
      'PATCH /api/v1/tasks/:id, POST /api/v1/tasks, DELETE /api/v1/tasks/:id underneath the store.',
    ],
    feedback: [
      'Completion holds the row in place for ~1.6s (check, strikethrough, confetti) before it glides out via the shared taskDepart transition — the same choreography as every other task surface.',
      '"Nothing to do for {CODE} — you\'re caught up." empty state.',
      'A "+N more →" overflow link once Next-7-days exceeds 5 rows.',
      'A store-level failure (toggle/add/delete) rolls back optimistically and surfaces via the global toast (tasksError → Toast.svelte), not an inline message here.',
    ],
    docs: [SCREENS, API, 'src/lib/stores/tasks.ts', 'src/lib/completionMotion.ts'],
  },
  {
    name: 'GradeStatCard',
    selector: '.slot-standing',
    purpose: 'The old grade-standing hero, demoted to a compact rail stat — something to check, not something to act on.',
    affordances: ['Read the weighted grade (official assessments only) and how many of the official assessments are graded so far.'],
    actions: ['No writes of its own — pure props from the parent island\'s GET /api/v1/grades/summary call.', '"Enter grades →" jumps to the Assessments card\'s anchor (#assessments).'],
    feedback: ['"—" and "No grades entered yet." before any official assessment has a grade.', 'The figure is a plain `.figure`-class number, no animation on change.'],
    docs: [SCREENS, JOURNEYS, API, 'src/components/course/GradeStatCard.svelte'],
  },
  {
    name: 'MasteryCard',
    selector: '.slot-mastery',
    // No asterisk in screens.md's Key Components list for this one (unlike
    // its siblings) — it's a plain nested Svelte component inside the
    // already-hydrated CourseHome island, not its own separately-mounted
    // client:* island. Preserved here rather than "corrected," since it's
    // an accurate distinction the doc is making.
    purpose: 'Reference breakdown of mastery by concept branch, for a student who wants the fuller picture beyond "what to do next."',
    affordances: ['Scan each branch\'s average mastery as a labeled bar + percent.'],
    actions: ['No writes — pure props (branches, each with its KCs\' mastery) passed down from CourseHome, itself server-seeded, zero client fetches.'],
    feedback: ['"No branches yet." empty state.', 'At container width ≤480px, the branch name sits above its bar instead of beside it so long names never compete with the bar for width.'],
    docs: [SCREENS, 'src/components/standing/MasteryCard.svelte'],
  },
  {
    name: 'PracticeCard',
    selector: '.slot-practice',
    purpose: 'A quick "how much have I actually practiced" readout for the course, with one link into the practice tab.',
    affordances: ['Read concepts-practiced count, recent practice-activity count, last-practiced-when, and (if any exist) practice-test completion count.', '"Go practice →" jumps to /courses/[slug]/practice.'],
    actions: ['GET /api/v1/courses/:id/practice-summary — refetches whenever the parent bumps a shared refreshToken (e.g. after AssessmentsCard adds/marks a practice assessment), so the numbers never go stale mid-visit.'],
    feedback: [
      '"No concepts to practice yet." when the course has zero KCs.',
      '"No practice yet — start with a quick quiz." when there are KCs but no practice history at all.',
      'A load failure shows "Could not load practice." (or the network-specific message) in place of the stats — no retry button.',
    ],
    docs: [SCREENS, API, 'src/components/standing/PracticeCard.svelte'],
  },
  {
    name: 'RecentActivityCard',
    selector: '.slot-activity',
    purpose: "A raw, correctable log of this course's recent events — the paper trail behind the mastery fold.",
    affordances: [
      'Re-type a manually-logged event\'s type (e.g. correct a mis-tagged reading_done → video_watched) — only manual-source events are editable.',
      'Delete an event row outright.',
      '"Show all (N)" beyond the first 6 rows.',
    ],
    actions: ['PATCH /api/v1/events/:id — type correction.', 'DELETE /api/v1/events/:id.'],
    feedback: [
      '"No events logged for this course yet." empty state.',
      'Per-row inline feedback ("Updated.", or the error text) after a type-correction save.',
      'A delete has no confirm-undo — it asks via a native confirm() dialog first, then removes the row immediately on success.',
    ],
    docs: [SCREENS, API, 'src/components/standing/RecentActivityCard.svelte'],
  },
  {
    name: 'UnderstandNext',
    selector: '.slot-understand',
    purpose: 'Points at the handful of concepts most worth an absorb session right now — the course\'s forward-looking "what to learn" pointer, distinct from To do\'s "what to finish."',
    affordances: [
      'See up to 4 KC picks: weakest started KCs, ties broken by staleness (an "idle Nd" pill), plus a guaranteed slot for the next untouched KC in curriculum order (a "not started" pill).',
      'Follow "Understand →" straight into the /learn/[kcId] guided flow for a pick.',
      'Follow the KC\'s own name link into its detail page (/courses/[slug]/kc/[kcId]).',
      '"All concepts →" to the full Concepts tab.',
    ],
    actions: ['No writes — pure client-side selection (selectUnderstandNext in src/lib/understandNext.ts) over branches/KCs already in CourseHome\'s server-seeded props; zero fetches of its own.'],
    feedback: ['Renders nothing at all (not even an empty-state message) when there is nothing worth pointing at — e.g. every KC already mastered.'],
    docs: [SCREENS, JOURNEYS, 'src/components/course/UnderstandNext.svelte', 'src/lib/understandNext.ts'],
  },
  {
    name: 'UpNextCard',
    selector: '.slot-upnext',
    purpose: "The nearest dated official assessments and how much each counts — replaces the old unfiltered 30-day DeadlinesCard feed.",
    affordances: ['Scan up to 4 upcoming official, dated assessments with their weight % and an urgency pill (e.g. "due tomorrow").', '"All assessments →" jumps to the Assessments card\'s anchor (#assessments).'],
    actions: ['No writes — derives its list client-side from the assessments array the parent island already fetched (no extra request).'],
    feedback: ['"No dated assessments ahead." empty state.'],
    docs: [SCREENS, 'src/components/course/UpNextCard.svelte'],
  },
];

// ---------------------------------------------------------------------------
// /dashboard
// ---------------------------------------------------------------------------

const dashboardComponents: Annotation[] = [
  {
    name: 'CourseCards',
    selector: '.slot-courses',
    purpose: 'A slimmed roster of this term\'s courses — identity + standing at a glance, with the door into each course\'s own Overview.',
    affordances: ['Click a card to open /courses/[slug].', 'Read each course\'s grade pill and one muted meta line ("N tasks open · next due Fri").'],
    actions: ['No writes — server-rendered links only; task-open-count and next-due are computed server-side per course from the already-fetched task list.'],
    feedback: [
      '"No courses yet." empty state.',
      'Hover lifts the card (translateY + shadow) — no other interaction feedback since this is a pure navigation card.',
      'At container width ≤480px the grid becomes a horizontally snapping row with an intentional next-card peek instead of a hard-cropped edge.',
    ],
    docs: [SCREENS, CHARTER, 'src/components/dashboard/CourseCards.astro'],
  },
  {
    name: 'DeadlinesList',
    selector: '.slot-deadlines',
    purpose: "Assessment-due dates only — the v1.4 rename/narrowing of the old DueList, since overdue-task nagging now lives in TodayTasks/grade_entry tasks instead.",
    affordances: ['Scan nearby assessment deadlines with an urgency pill and the linked course.', '"Plan a session →" jumps to /planner.'],
    actions: ['No writes — server-rendered from the calendar feed, filtered to type === "assessment_due" (verified against src/pages/dashboard.astro — this is stricter than a generic "calendar window," matching the doc\'s claim exactly).'],
    feedback: ['"No deadlines coming up." empty state.'],
    docs: [SCREENS, 'src/components/dashboard/DeadlinesList.astro', 'src/pages/dashboard.astro'],
  },
  {
    name: 'RecordEventCard',
    selector: '.slot-record',
    purpose: 'A standing door to log anything that happened outside the app — a lecture, a grade, a practice set — from the dashboard rail.',
    affordances: ['Fill in the quick-event form (course, KC, event type, details) and submit.'],
    actions: ['POST /api/v1/events (via QuickEventForm.svelte, hydrated client:visible) — the same event-log path the header\'s Record-event pill and mobile FAB open, just embedded inline here instead of in a modal.'],
    feedback: ['Deferred to QuickEventForm\'s own success/error handling — not documented at this layer.'],
    docs: [SCREENS, JOURNEYS, API, 'src/components/dashboard/RecordEventCard.astro'],
  },
  {
    name: 'TodayTasks',
    selector: '.slot-today',
    purpose: 'The hallway job — dashboard\'s task-centric hero. Check things off without going anywhere else first.',
    affordances: [
      'Check off a task inline (typed tasks — attend_class, prep_before_class, etc. — detour through the completion recap dialog; plain todos complete instantly).',
      'Snooze a system task by a day, delete it, or log a practice event, via the row\'s hover/⋯ action cluster.',
      'Mint a one-tap "wellness" todo (Take a walk / Message family / Drink water / Tidy desk) due today at noon.',
      'Expand "Catch up" for past attend_class rows still unmarked.',
      '"All tasks →" jumps to /tasks.',
    ],
    actions: [
      'Reads/writes the shared tasks store (src/lib/stores/tasks.ts): hydrateTasks (SSR seed, first-hydrator-wins), toggleTask, addTask, snoozeTask, deleteTask.',
      'PATCH /api/v1/tasks/:id, POST /api/v1/tasks, DELETE /api/v1/tasks/:id underneath the store.',
    ],
    feedback: [
      'Completing a task: checkbox pop + ring pulse + confetti, then the row holds its place ~1.6s (COMPLETION_HOLD_MS) before departing via a fade+collapse+rightward-drift transition (taskDepart) — reduced-motion degrades to a plain opacity fade.',
      'The wellness chip flashes a brief pressed state (aria-pressed, ~1s) as a tap acknowledgment — it does not reflect the add actually succeeding or failing.',
      '"Nothing on your plate — you\'re caught up." empty state.',
      'A section count next to each bucket label ("Overdue · 3") gives plate-size at a glance.',
      'A failed toggle/add/delete rolls back optimistically and surfaces through the global toast queue (tasksError → Toast.svelte), not inline.',
    ],
    docs: [SCREENS, JOURNEYS, LIFECYCLE, API, 'src/lib/stores/tasks.ts', 'src/lib/completionMotion.ts'],
  },
  {
    name: 'WeekView',
    selector: '.slot-week',
    purpose: 'A collapsed-by-default miniature of the planner — "what does my next 7 days look like" without leaving the dashboard.',
    affordances: [
      'Toggle between a collapsed 7-day chip strip and a full expanded WeekGrid (state persisted via localStorage `sb:weekview`).',
      'Hover a collapsed-view chip for a preview card (~150ms delay); click any item (chip or expanded-grid block) to open its EventPopover in place, without navigating away.',
      'Click an empty slot in the expanded grid to open an inline CreateSessionPopover.',
      '"Open planner →" for the full /planner surface.',
    ],
    actions: [
      'GET /api/v1/calendar?from=&to= — lazily loads the fuller expanded-week window on first expand (the collapsed view runs off the page\'s SSR-seeded 7-day window).',
      'Selecting/creating routes through the same EventPopover/CreateSessionPopover components the full planner uses.',
    ],
    feedback: [
      'Expand/collapse morphs height via a grid-template-rows 0fr→1fr transition (not a hard swap) so surrounding page content rides the same animation.',
      'An attend_class chip flips its glyph (○/●) live off `details.done` independent of every other chip.',
      'At container width ≤616px the 7-day strip becomes a horizontally snapping scroll row.',
    ],
    docs: [SCREENS, PLANNER_UX, 'src/components/dashboard/WeekView.svelte'],
  },
];

// ---------------------------------------------------------------------------
// /learn/[kcId] — Absorb (guided understanding), v1.7
// ---------------------------------------------------------------------------

const learnComponents: Annotation[] = [
  {
    name: 'AbsorbFlow',
    selector: '.absorb-flow',
    purpose: 'Orchestrates the whole 4-stage absorb experience for one KC — prereq map, verify, interest-order, then the actual teaching conversation.',
    affordances: ['Move through the 4 stages in order (map → verify → rank → chat), or short-circuit straight to the tutor chat if there\'s nothing to verify/rank (a leaf KC, or 0 remaining prereqs).'],
    actions: [
      'GET /api/v1/kcs/:id/graph — re-fetched after a verify quiz completes, to reflect updated readiness.',
      'POST /api/v1/tutor/conversations ({ kc_id, mode: "absorb", details: { flow: "absorb", focus_order } }) — starts Stage 4\'s conversation once ranking (or the skip path) decides an order.',
    ],
    feedback: [
      'This wrapper always stays mounted — only its single child stage swaps underneath it, so the overlay never has to re-anchor between stages.',
      '"Starting your session…" is shown briefly between the ranking stage finishing and the chat stage mounting.',
      'A failed graph-refetch or conversation-create surfaces via the global toast queue.',
    ],
    docs: [SCREENS, JOURNEYS, LIFECYCLE, API, 'src/components/learn/AbsorbFlow.svelte'],
  },
  {
    name: 'InterestRanker',
    selector: '.ranker',
    // Only rendered client-side once AbsorbFlow's `stage` state reaches
    // 'rank' (after "Continue anyway"/verify-done, and only when the KC has
    // >0 prerequisites) — it did NOT resolve against the at-rest SSR HTML
    // fetched for this registry. Selector confirmed by reading the component
    // source (src/components/learn/InterestRanker.svelte:41), not by curl.
    purpose: 'Stage 3 — student taps to rank the KCs they\'re about to cover by interest before diving in; the target KC always lands last regardless of taps.',
    affordances: [
      'Tap KCs in the order that interests you most; each tap moves it into the ranked list.',
      '"Skip — use default order" to bypass ranking (falls back to whatever order the KCs were already in).',
      '"Back" returns to the prereq map (Stage 1).',
      '"Start the session" once ranking (or skip) is settled.',
    ],
    actions: ['No direct writes — produces a client-side `focus_order` array that AbsorbFlow passes into POST /api/v1/tutor/conversations at Stage 4.'],
    feedback: ['Not verified to resolve against the running app in this pass — only rendered after tapping "Continue anyway" (or verify completing) on a KC with ≥1 prerequisite; see report.'],
    docs: [JOURNEYS, LIFECYCLE, API, 'src/components/learn/InterestRanker.svelte'],
  },
  {
    name: 'PrereqGraph',
    selector: '.prereq-map',
    purpose: 'Stage 1 — shows the target KC\'s prerequisites grouped by hop-distance, so the student can see what to shore up before diving into new material.',
    affordances: [
      'Scan prerequisites grouped by "N hops away," each marked ready (✓) or not-ready (!) against the mastery review threshold, with a live mastery bar/percent per node.',
      '"Verify N weak prerequisites" → Stage 2, scoped to exactly the not-ready set.',
      '"Continue anyway" (or, if every prereq is already ready, a plain "Continue") → Stage 3 (or straight to Stage 4 for a leaf KC / all-ready case).',
    ],
    actions: ['Rendered from `GET /kcs/:id/graph`\'s traversal (SSR-seeded via AbsorbFlow\'s initialPrereqs prop; re-fetched after a verify quiz).'],
    feedback: ['Any traversal anomaly (e.g. a defensively-caught cycle) surfaces as a plain warning string rather than breaking the stage.'],
    docs: [JOURNEYS, LIFECYCLE, API, 'src/components/learn/PrereqGraph.svelte'],
  },
  {
    name: 'ScaffoldChat',
    selector: '.tutor-chat',
    // Only mounts once AbsorbFlow's `stage` reaches 'chat' (Stage 4) — a
    // plain page load sits on Stage 1 (PrereqGraph) instead, so this did NOT
    // resolve against the at-rest SSR HTML fetched for this registry.
    // Selector confirmed by reading src/components/tutor/ScaffoldChat.svelte:164.
    //
    // Correction vs. how this component is framed elsewhere: it is NOT
    // directly embedded in the course Play or Practice tabs. Play's KC rows
    // (PlayPanel.svelte) link OUT to the standalone /tutor/[kcId] page
    // (which renders this same component) rather than mounting it inline;
    // Practice uses QuickQuiz.svelte instead, a different, drill-based
    // component. So the only two places this component's own DOM actually
    // renders are /learn/[kcId] (this entry, Stage 4) and /tutor/[kcId]
    // (a separate page, not one of this registry's six in-scope routes).
    // Verified via `grep -rl ScaffoldChat src/` — only AbsorbFlow.svelte and
    // src/pages/tutor/[kcId].astro import it.
    purpose: 'Stage 4 — the actual teaching conversation for this KC: a streamed tutor chat using the KC\'s matched scaffolds and watching for its documented misconceptions. Also the same component behind the standalone /tutor/[kcId] page (reached from KC detail\'s "Tutor me" link and the Play tab\'s KC rows) in its five other modes (recall/classify/worked_example/self_explain/interactive_model) — only the mode differs, not the chat UI.',
    affordances: [
      'Send messages in a streamed conversation with the tutor.',
      'Accept or dismiss an inline "Worth correcting" card when the tutor flags a misconception.',
      'End the conversation with an optional 1-5 self-rating.',
    ],
    actions: [
      'POST /api/v1/tutor/conversations/:id/messages — streamed (text/event-stream) reply.',
      'Accepting a correction card → POST /api/v1/corrections.',
      'Ending → POST /api/v1/tutor/conversations/:id/end (also fires automatically at the 30-message cap).',
    ],
    feedback: [
      'Not resolved at rest in this pass — see the source note above.',
      'A detected misconception renders as an inline `.correction-card` on the assistant\'s message; accepting flips it to a "✓ In your ledger" confirmation in place, no navigation away from the chat.',
    ],
    docs: [JOURNEYS, LIFECYCLE, API, 'src/components/tutor/ScaffoldChat.svelte', 'src/components/learn/AbsorbFlow.svelte'],
  },
  {
    name: 'VerifyQuiz',
    selector: '.verify-quiz',
    // Same caveat as InterestRanker — only mounts once `stage` becomes
    // 'verify' (clicking "Verify N weak prerequisites" in PrereqGraph). Not
    // resolved against the at-rest SSR HTML; selector confirmed by reading
    // src/components/learn/VerifyQuiz.svelte:89.
    purpose: 'Stage 2 — a short quiz scoped to exactly the weak prerequisites, confirming or correcting the student\'s standing before they move on.',
    affordances: [
      'Answer a small MCQ set (auto-starts on mount, no setup step).',
      '"Back to prereqs" to bail out mid-quiz without finishing.',
      'After grading: see a score, then "Back to prerequisites" to return to Stage 1 with updated readiness — or "Try again" on an error.',
    ],
    actions: ['POST /api/v1/flows/quick_quiz with explicit `kc_ids` (the not-ready prereq set) — overrides the normal mastery-heuristic KC selection entirely.'],
    feedback: ['Not verified to resolve against the running app in this pass — only rendered after clicking "Verify N weak prerequisites" on the prereq map; see report.'],
    docs: [JOURNEYS, LIFECYCLE, API, 'src/components/learn/VerifyQuiz.svelte'],
  },
];

// ---------------------------------------------------------------------------
// /planner
// ---------------------------------------------------------------------------

const plannerComponents: Annotation[] = [
  {
    name: 'AgendaList',
    selector: '.agenda-list',
    purpose: 'A flat, day-grouped list framing of the calendar — the mobile default view, since a time-grid doesn\'t fit a phone the way a scrollable list does.',
    affordances: ['Scroll a chronological list of items grouped under "Today"/"Tomorrow"/weekday headers.', 'Click an item to open its EventPopover.'],
    actions: ['No writes of its own — renders PlannerView\'s already-loaded, pre-sorted items array; `scrollToDate` (set after a mobile CalendarGrid day-tap) scrolls a group header into view rather than fetching anything new.'],
    feedback: [
      // Desktop's SSR default view is Week (PlannerView's `view` state
      // defaults to isMobile.get() ? 'agenda' : 'week', and isMobile reads
      // false server-side), so a plain desktop page load never renders this
      // — it IS the mobile default, but our live verification used a
      // desktop UA/curl, so it wasn't observed rendering. Selector confirmed
      // by reading src/components/planner/AgendaList.svelte:84 (root:
      // `<ul class="agenda-list">`), not by a curl that actually hit it.
      'Not resolved against a desktop curl in this pass — mounts only when the view switcher is Agenda (the mobile default; see the source note above).',
    ],
    docs: [PLANNER_UX, MOBILE_SHELL, 'src/components/planner/AgendaList.svelte'],
  },
  {
    name: 'CalendarGrid',
    selector: '.month-grid',
    purpose: 'Month-at-a-glance framing of the same calendar data — good for spotting clusters of deadlines/sessions across weeks, at the cost of per-day detail.',
    affordances: [
      'Switch into this view via the week/month/agenda switcher.',
      'Click an event chip within a day cell to open its EventPopover.',
      'Tap a day cell itself (not a chip) on mobile to jump into Agenda scrolled to that date — desktop keeps chips-only behavior.',
    ],
    actions: ['No writes of its own — renders the same items/course data PlannerView already loaded; a mobile day-tap hands off to AgendaList via PlannerView\'s `agendaScrollTarget` state, not a navigation.'],
    feedback: [
      // Only mounts once the view switcher is set to Month; PlannerView's
      // SSR default view is Week (desktop) or Agenda (mobile), so a plain
      // page load never renders it. Confirmed by reading
      // src/components/planner/CalendarGrid.svelte:66 (root:
      // `<div class="month-grid">`), not by a live curl.
      'Not resolved at rest in this pass — only mounts when the view switcher is Month; see the source note above.',
    ],
    docs: [PLANNER_UX, 'src/components/planner/CalendarGrid.svelte', 'src/components/planner/PlannerView.svelte'],
  },
  {
    name: 'CreateSessionPopover',
    selector: '.create-popover',
    purpose: 'Inline create form for a new study session, class, or plain task at a clicked (or drag-selected) time slot — no separate modal for the common case.',
    affordances: [
      'Pick a type: Study session / Class / Other.',
      'Adjust duration via a preset dropdown (a drag-created range injects its own exact duration as an extra option).',
      'Submit to create, or dismiss without creating.',
    ],
    actions: ['POST /api/v1/sessions (Study session), POST /api/v1/courses/:id/class-sessions (Class), or POST /api/v1/tasks (Other), depending on the picked type.'],
    feedback: [
      // Only mounts after clicking an empty grid slot (or completing a
      // drag-select) in WeekGrid. Confirmed by reading
      // src/components/planner/CreateSessionPopover.svelte:245 (desktop
      // root: `<form class="create-popover popover">`; on mobile it renders
      // inside a bottom Sheet instead, as `.create-popover-body`).
      'Not resolved at rest in this pass — only mounts after clicking an empty slot or completing a drag-select on WeekGrid; see the source note above.',
      'A submit failure shows an inline error in the popover; success calls `onCreated`, which reloads the visible week.',
    ],
    docs: [PLANNER_UX, MOBILE_SHELL, API, 'src/components/planner/CreateSessionPopover.svelte'],
  },
  {
    name: 'EventPopover',
    selector: '.event-popover',
    purpose: 'View or edit one calendar item in place — a task, assessment, class session, study session, or logged event — without leaving the grid.',
    affordances: [
      'Toggle a task_due item\'s completion right from the popover.',
      'Mark a class_session attended/missed, or edit its note.',
      'Reschedule or delete a study_session (v1.6); delete a manually-logged event.',
      '"Open in planner" link when shown from a compact host (e.g. dashboard WeekView) that isn\'t the full planner itself.',
    ],
    actions: [
      'PATCH /api/v1/tasks/:id (task_due toggle), PATCH /api/v1/class-sessions/:id (status/note), PATCH/DELETE /api/v1/sessions/:id (study_session reschedule/delete), DELETE /api/v1/events/:id (manual event).',
      'Assessment_due items and seeded/session/tutor-sourced events have no delete affordance here — only manually-logged events and study sessions can be removed from this popover.',
    ],
    feedback: [
      // Only mounts after clicking an existing item in WeekGrid, the
      // dashboard WeekView's chips, CalendarGrid, or AgendaList. Confirmed
      // by reading src/components/planner/EventPopover.svelte:420 (desktop
      // root: `<div class="event-popover popover">`; on mobile it renders
      // inside a bottom Sheet instead, as `.event-popover-body`).
      'Not resolved at rest in this pass — only mounts after clicking an existing calendar item; see the source note above.',
      'A task-checkbox toggle inside the popover bursts the same confetti/celebration as everywhere else (burstConfetti + markFlowCelebration), so completing from here still feels like completing on a task list.',
      'A delete asks for an inline two-step confirm before actually deleting.',
    ],
    docs: [PLANNER_UX, MOBILE_SHELL, API, 'src/components/planner/EventPopover.svelte'],
  },
  {
    name: 'PlannerRail',
    selector: '.planner-rail',
    purpose: 'Surfaces unscheduled tasks and near-term deadlines alongside the grid so weekly planning doesn\'t require a second trip to /tasks.',
    affordances: [
      'Scan items grouped Overdue / Due today-tomorrow / This week, each with a course chip, type icon, title, and due label.',
      'Click a rail item: if its week is already on screen, opens its own view/edit popover in place; otherwise jumps the grid to that item\'s week and selects it there.',
    ],
    actions: ['No writes of its own and no scheduling affordance — clicking a rail item can only view or jump-to-week, never schedule. Click-to-schedule and drag-to-schedule from the rail are both spec\'d but neither is built (confirmed against PlannerRail.svelte 2026-08-15) — see docs/todo.md\'s deferral list.'],
    feedback: ['"Nothing due this week." empty state.', 'An overdue rail item gets a red left-border accent.'],
    docs: [PLANNER_UX, LIFECYCLE, 'src/components/planner/PlannerRail.svelte'],
  },
  {
    name: 'PlannerView',
    selector: '.planner-view',
    purpose: 'The orchestrating shell for the whole /planner overlay — owns which view (week/month/agenda) and which course-filter is active, and wires the grid/rail/popovers together.',
    affordances: [
      'Switch between week (time-grid), month, and agenda views via the same view switcher.',
      'Filter by current-term / all courses / a single course.',
      'Page the visible range with the ‹/› chevrons or the `t`/arrow-key/j-k keyboard shortcuts.',
      'Escape (or the close button, desktop only) dismisses back to /dashboard or history.back().',
    ],
    actions: [
      'GET /api/v1/calendar?from=&to=&course= — reloads on week/filter change.',
      'Supports deep links via `?event=<id>&date=<iso-date>` query params (opens that item\'s popover on load).',
    ],
    feedback: [
      'Mobile (≤767px, per docs/design/mobile-shell.md): stops being a centered scrim+modal and becomes a full page between the header and tab bar (no scrim, no close button — dismissed by tapping another tab); defaults to Agenda view instead of the week grid.',
      'Week paging is a 150-200ms horizontal slide, not a hard cut.',
    ],
    docs: [SCREENS, PLANNER_UX, MOBILE_SHELL, JOURNEYS, API, 'src/components/planner/PlannerView.svelte'],
  },
  {
    name: 'WeekGrid',
    selector: '.week-grid',
    all: true,
    purpose: 'The actual time-grid surface — hour-by-hour columns of classes, sessions, and deadlines for the visible days.',
    affordances: [
      'Click an existing event block to open its EventPopover (view/edit/delete).',
      'Click an empty slot to open an inline CreateSessionPopover pre-filled with a 30-min duration at that time; drag (desktop, mouse only) a range instead for a custom duration.',
      'Hover a block for a preview card (~200ms delay) before clicking.',
      'A live now-line marks the current time across all visible day columns.',
    ],
    actions: [
      'Selecting/creating routes through EventPopover / CreateSessionPopover, which POST to /api/v1/sessions, /api/v1/courses/:id/class-sessions, or /api/v1/tasks depending on the picked type.',
      'Container-measures its own rendered width (not a viewport media query, since it renders both inside the fixed planner overlay AND inline on the dashboard) to decide day count: 7 days ≥760px, 3 days 480–760px, 1 day <480px — always anchored so "today" is the leftmost visible column, never locked to Sun–Sat.',
    ],
    feedback: [
      'Overlapping events in a day use greedy interval-graph coloring (first-fit column assignment); every block has a 24px minimum rendered height regardless of actual duration.',
      'Past events within today dim to ~60% opacity; entire past days do not.',
      'An empty day shows a soft "Nothing scheduled — tap any time to add a study block" line rather than a blank column.',
      'Drag/resize snaps to 15-minute increments.',
    ],
    docs: [SCREENS, PLANNER_UX, CHARTER, 'src/components/planner/WeekGrid.svelte'],
  },
];

// ---------------------------------------------------------------------------
// /settings
// ---------------------------------------------------------------------------

const settingsComponents: Annotation[] = [
  {
    name: 'AppearanceSettings',
    selector: '.swatches',
    purpose: 'Pick a visual identity (theme) and a light/dark/system preference — cosmetic only, never a layout change (see docs/design/charter.md\'s theme rule).',
    affordances: [
      'Click a theme swatch (Compass / Focus / Campus) — each preview shows its bg/surface/accent colors plus an "Aa" glyph in the theme\'s actual display font.',
      'Click Light / Dark / System in the scheme segmented control.',
    ],
    actions: ['PATCH /api/v1/user with { settings: { theme, scheme } } — also stamps `data-theme`/`data-scheme` on <html> and mirrors both to localStorage (`sb:theme`/`sb:scheme`) immediately, client-side, ahead of the network round-trip.'],
    feedback: [
      'The whole app re-themes instantly on click (stampHtml runs before the PATCH resolves) — a failed save shows an error toast ("Could not save appearance settings") but the visual choice already took effect locally.',
      'A brief "Saving…" line while the request is in flight.',
    ],
    docs: [SCREENS, CHARTER, API, 'src/components/settings/AppearanceSettings.svelte'],
  },
  {
    name: 'TaskGeneratorSettings',
    selector: '.generator-list',
    purpose: 'Opt in or out of each automatic-task family the nightly/on-load sweep generates, one row per generator.',
    affordances: ['Toggle a checkbox per generator family (attend_class, prep_before_class, review_after_class, practice_kc, stale_kc, grade_entry), each with a plain-language description of what it does.'],
    actions: ['PATCH /api/v1/user with { settings: { task_generators: { [key]: next } } } — a partial patch that deep-merges server-side and never clobbers sibling toggles.'],
    feedback: [
      'Optimistic checkbox flip; a failed save rolls it back and shows an error toast naming the specific setting.',
      'A "Saved" confirmation appears next to the row for ~2s after a successful toggle.',
    ],
    docs: [SCREENS, API, 'src/components/settings/TaskGeneratorSettings.svelte'],
  },
];

// ---------------------------------------------------------------------------
// /tasks
// ---------------------------------------------------------------------------

const tasksComponents: Annotation[] = [
  {
    name: 'TaskItem',
    selector: '.task-row',
    all: true,
    purpose: 'One task, everywhere it appears (dashboard, this page, the header dropdown) — the shared unit for "here\'s a thing, check it off."',
    affordances: [
      'Check the box to complete (typed tasks open a recap dialog first; plain todos complete instantly).',
      'Hover the row (fine pointers), focus into it (keyboard), or tap its persistent "⋯" (coarse pointers) to reveal snooze / delete / log-practice actions — content-only at rest, so the row never carries permanent chrome.',
      'Read urgency (a due pill), which course(s) it belongs to (full course code chips, not anonymous dots), and provenance (an "auto" chip for system-generated rows) on a meta line below the title.',
    ],
    actions: [
      'toggleTask/deleteTask/snoozeTask from src/lib/stores/tasks.ts → PATCH/DELETE /api/v1/tasks/:id.',
      '"Log practice" dispatches a window `open-record-event` CustomEvent — the same Record-event modal the header pill and mobile FAB open — rather than its own endpoint (only shown for practice_kc/stale_kc tasks).',
      'Snooze is offered only for system-sourced, dated, incomplete tasks (`canSnooze`); it pushes due_date to tomorrow, same time-of-day if one existed.',
    ],
    feedback: [
      'Check, savor, bow out: checkbox pop + ring pulse + confetti on check, a ~1.6s hold with strikethrough visible, then a fade+collapse+drift departure (taskDepart) — reduced-motion collapses this to a plain opacity fade.',
      'The action cluster fades in/out (opacity + slight translate) rather than popping, on both hover and focus-within.',
      'A completion/delete/snooze failure rolls back optimistically and surfaces via the global toast, not inline on the row.',
    ],
    docs: [SCREENS, API, 'src/components/tasks/TaskItem.svelte', 'src/components/tasks/TaskQuickActions.svelte', 'src/components/tasks/CompletionFlow.svelte', 'src/lib/completionMotion.ts', 'src/lib/stores/tasks.ts'],
  },
  {
    name: 'TaskQuickActions',
    selector: '.qa',
    all: true,
    purpose: 'The row-scale hover/focus/⋯ action cluster for a task — snooze, delete, log-practice — kept out of the row\'s at-rest chrome since completing (the checkbox) is the one action that should always cost nothing.',
    affordances: [
      'Present on every non-compact task row but visually hidden at rest — revealed on row hover (fine pointers only), on keyboard focus entering the cluster (`:focus-within`), or via a persistent "⋯" disclosure button that only exists on coarse pointers (touch).',
      'Snooze (postpone the due date by a day) — only offered for system-sourced, dated, incomplete tasks.',
      'Delete the task (asks a native confirm first).',
      'Log a practice event — only offered for practice_kc/stale_kc tasks; opens the same Record-event modal as the header pill/FAB.',
    ],
    actions: [
      'snoozeTask/deleteTask from src/lib/stores/tasks.ts → PATCH/DELETE /api/v1/tasks/:id.',
      '"Log practice" dispatches a window `open-record-event` CustomEvent rather than its own endpoint.',
      'On coarse pointers, tapping "⋯" opens the cluster leftward (not overlaying the "⋯" itself) specifically so the tap that opened it can\'t also land on delete.',
    ],
    feedback: [
      'Fades in/out via opacity + a slight translateX, not a hard show/hide — matches the shared fast-motion token.',
      'Outside-tap dismissal only listens while the "⋯" disclosure is open, so an idle row costs nothing.',
    ],
    docs: [SCREENS, 'src/components/tasks/TaskQuickActions.svelte', 'src/components/tasks/TaskItem.svelte'],
  },
  {
    name: 'TasksView',
    selector: '.tasks-view',
    purpose: '"What\'s actually due, and what has the app already lined up for me" — every open task, user and system alike, one card per course.',
    affordances: [
      'Filter by All / a per-course chip / Other via the filter bar (syncs `?course=` in the URL).',
      'Inline-add a task to a course card ("+ Add task").',
      'Expand a task to add/check one level of subtasks (chevron + "N/M" progress pill); checking a parent completes its remaining children.',
      'Expand a quiet "Catch up" disclosure for idle past attend_class rows, and a "Done (N)" disclosure for completed tasks.',
    ],
    actions: ['Same shared tasks store as TaskItem/TodayTasks/CourseTasks — toggleTask (with cascadeChildren for parent-completes-children), addTask, deleteTask, snoozeTask.'],
    feedback: [
      'Mobile (≤767px): same full-page route-modal treatment as /planner (scrim+panel on desktop, full page between header/tab-bar on mobile); checkboxes and delete grow to ≥44px hit targets.',
      'Same completion hold/depart choreography as every other task surface — a task survives ~1.6s in its "open" position (via the recentlyCompletedIds grace set) so the completing dialog never blinks out from under the user mid-press.',
    ],
    docs: [SCREENS, MOBILE_SHELL, JOURNEYS, API, 'src/components/tasks/TasksView.svelte'],
  },
  {
    name: 'TaskTypeIcon',
    selector: '.task-type-icon',
    all: true,
    purpose: 'A small glyph naming a system-generated task\'s type (attend class, prep before class, etc.) — renders nothing at all for a plain todo, so icon-less rows stay the calm default.',
    affordances: ['Hover for a title tooltip naming the exact type (e.g. "Prep before class").'],
    actions: ['No writes — a pure presentational SVG keyed off TASK_TYPE_META[task.type].iconPath.'],
    feedback: ['Nothing rendered at all for type "todo" — not an empty box, no DOM node (every other task type has a matching icon path, including grade_entry).'],
    docs: [SCREENS, 'src/components/tasks/TaskTypeIcon.svelte', 'src/components/tasks/TaskItem.svelte'],
  },
];

// ---------------------------------------------------------------------------
// ROUTE_ANNOTATIONS — alphabetized by route pattern.
// ---------------------------------------------------------------------------

export const ROUTE_ANNOTATIONS: RouteAnnotation[] = [
  {
    route: '/courses/[slug]',
    title: 'Course Overview',
    purpose: 'Answers "what do I do for this course now?" before "how am I doing?" — the v1.8 task-oriented rebuild that retired StandingTab/TasksCard/DeadlinesCard.',
    jobs: [
      'See this course\'s open tasks in the same idiom as the dashboard, without leaving the course.',
      'Get pointed at the few concepts most worth an absorb session right now.',
      'Mark today\'s (or the last unmarked) class session attended/missed in one tap.',
      'Check standing, enter grades, and browse the mastery-by-branch breakdown when that\'s actually the question.',
    ],
    flows: [
      'Grade entry fans out into one assessment event per KC linked via assessment_kcs, which feeds the mastery fold — see student-lifecycle.md §7.',
      'Attendance marking two-way-syncs the linked attend_class task; logging a lecture_attended/missed event (Record Event modal) is a separate, optional path that actually feeds mastery credit — see student-lifecycle.md §3.',
      'Understand Next\'s picks link straight into the /learn/[kcId] absorb flow.',
    ],
    docs: [SCREENS, LIFECYCLE, CHARTER, API],
    components: courseOverviewComponents,
  },
  {
    route: '/dashboard',
    title: 'Dashboard',
    purpose: '"What do I need to do today? Any deadlines lurking?" — a task-centric status check that re-keys around tasks first, everything else after.',
    jobs: [
      'Check what\'s due today/this week and clear it without a second trip.',
      'See standing per course at a glance (grade pill + one open-tasks meta line) without opening each course.',
      'Peek at the week ahead and jump into the full planner only if needed.',
      'Log an out-of-app event (a lecture, a grade, a practice set) from one standing form.',
    ],
    flows: [
      'The sweep\'s prep_before_class/review_after_class tasks surface here first — see student-lifecycle.md §2 and §4.',
      'A "Next 7 days" widget mirrors the planner in miniature; clicking through opens the same EventPopover/CreateSessionPopover in place before ever navigating to /planner.',
      'One-tap wellness chips mint a plain today-todo with no recurrence engine — a deliberately simple, hardcoded list.',
    ],
    docs: [SCREENS, JOURNEYS, LIFECYCLE],
    components: dashboardComponents,
  },
  {
    route: '/learn/[kcId]',
    title: 'Absorb',
    purpose: '"I want to actually understand this topic, not just drill it — and if I\'ve got something backwards, help me see where the mix-up came from."',
    jobs: [
      'Check readiness on a KC\'s prerequisites before diving into new material.',
      'Shore up any weak prerequisites via a short, explicitly-scoped quiz.',
      'Choose what order to tackle the material in, by interest.',
      'Learn via a scaffolded tutor conversation, and log any corrected misconceptions to a durable, revisitable ledger.',
    ],
    flows: [
      'The full 4-stage sequence — prereq map → verify → interest-rank → absorb chat — is diagrammed end-to-end in student-lifecycle.md §9.',
      'A detected misconception surfaces mid-chat as an inline accept/dismiss card; accepting posts to the corrections ledger (/corrections) and starts a ~14-day spaced reminder until marked internalized.',
      'Entry points: an "Understand" link on Concepts-tab KC rows, KC detail pages, and Play-tab KC rows (see user-journeys.md "Door 4").',
    ],
    docs: [JOURNEYS, LIFECYCLE, API],
    components: learnComponents,
  },
  {
    route: '/planner',
    title: 'Planner',
    purpose: 'The step-back view: what\'s due, what\'s scheduled, and where to slot study time this week.',
    jobs: [
      'See assessment due-dates, task due-dates, scheduled sessions, and logged events on one unified calendar.',
      'Drag-create a typed item (class / study session / other) directly on the grid.',
      'Triage unscheduled due-soon items via the rail without leaving the grid view.',
      'Toggle between week, month, and agenda framings of the same data.',
    ],
    flows: [
      'The full weekly-planning loop is diagrammed in student-lifecycle.md §5 — including the honest limit that PlannerRail items can only be viewed or jumped-to, never scheduled from the rail itself (deferred, see docs/todo.md).',
      'Deep links via `?event=<id>&date=<iso-date>` let notification links and "jump to this deadline" links from elsewhere in the app open the right popover directly.',
      '`/calendar` is a kept-alive 302 redirect into this route for old bookmarks.',
    ],
    docs: [PLANNER_UX, MOBILE_SHELL, JOURNEYS, LIFECYCLE],
    components: plannerComponents,
  },
  {
    route: '/settings',
    title: 'Settings',
    purpose: 'Control how the app looks and which automatic tasks it generates on your behalf.',
    jobs: [
      'Switch theme (Compass/Focus/Campus) and light/dark/system scheme.',
      'Opt in or out of each sweep-generated task family individually.',
      'Set display name and current term; log out.',
    ],
    flows: ['Every toggle here is server-persisted immediately (PATCH /api/v1/user) and mirrored client-side (localStorage + data-theme/data-scheme on <html>) so the next page load — via ThemeScript.astro — reflects it pre-paint with no flash.'],
    docs: [SCREENS, API, CHARTER],
    components: settingsComponents,
  },
  {
    route: '/tasks',
    title: 'Tasks',
    purpose: '"What\'s actually due, and what has the app already lined up for me?" — everything checkable, user todos and sweep-generated system tasks alike.',
    jobs: [
      'See every open task across all courses, grouped by course, with subtasks one level deep.',
      'Quick-add a task to a specific course or the neutral "Other" bucket.',
      'Snooze or dismiss a system-generated nag without leaving the list.',
      'Complete a typed task through its recap flow, then find it later in the "Done (N)" disclosure.',
    ],
    flows: [
      'This is where every sweep generator (attend_class, prep_before_class, review_after_class, practice_kc, stale_kc, grade_entry) actually surfaces — see docs/api.md\'s "The sweep" section and student-lifecycle.md\'s per-situation diagrams.',
      'Also reachable without leaving the current page via the header\'s TodoDropdown, which reads the same shared store.',
    ],
    docs: [SCREENS, JOURNEYS, LIFECYCLE, API],
    components: tasksComponents,
  },
];

// ---------------------------------------------------------------------------
// SHELL_ANNOTATIONS — shown on every route. Alphabetized by name.
// ---------------------------------------------------------------------------

export const SHELL_ANNOTATIONS: Annotation[] = [
  {
    name: 'BottomNav.astro',
    selector: '.bottom-nav',
    purpose: 'Mobile-only (≤767px) tab bar replacing the sidebar entirely — Home · Tasks · [Record FAB] · Planner · Courses.',
    affordances: [
      'Navigate to Home/Tasks/Planner/Courses.',
      'Tap the center FAB to open the Record-event modal from anywhere.',
    ],
    actions: ['Plain <a> navigation for the four tabs (active state computed server-side from Astro.url.pathname, same convention as Sidebar.astro).', 'The FAB dispatches a window `open-record-event` CustomEvent — HeaderActions.svelte listens and opens LogEventModal, the same path the desktop header pill and the `e` keyboard shortcut use.'],
    feedback: ['`display: none` above 767px — this component renders nothing at all on desktop.', 'Feed, Settings, Scratchpad, past-terms, and Add-course have no tab here — they live in the avatar sheet or on /courses instead.'],
    docs: [SCREENS, MOBILE_SHELL, 'src/components/shell/BottomNav.astro'],
  },
  {
    name: 'Header',
    selector: '.app-header',
    purpose: 'The sticky top bar — a center slot for course tabs/breadcrumbs, and (via HeaderActions) the global action cluster.',
    affordances: ['Read the current page\'s course-tab/breadcrumb context in the center slot.', 'Reach every HeaderActions control (see that entry) on the right.'],
    actions: ['Server component only — fetches the user\'s course list (for HeaderActions\' course-hue context) and mounts HeaderActions client:load; no interactivity of its own.'],
    feedback: ['Sticky (position: sticky, z-index 30) with a translucent blur backdrop.', 'Mobile (≤767px): gains its own "su" brand mark (the sidebar\'s is gone) and adds safe-area-aware top padding.'],
    docs: [SCREENS, MOBILE_SHELL, 'src/components/shell/Header.astro'],
  },
  {
    name: 'HeaderActions.svelte',
    selector: '.header-actions',
    purpose: 'The global action cluster reachable from every page: log an event, jot a note, see your tasks, get notified, manage your account.',
    affordances: [
      '"Record event" pill (or the `e` keyboard shortcut, or the mobile FAB) opens LogEventModal.',
      'Scratchpad popup — save a quick note to general or a specific course.',
      'Todo dropdown — top ~7 tasks with inline add, without leaving the current page.',
      'Notifications bell — a 60s visibility-aware poll for new notifications.',
      'Avatar menu — Profile/Settings/Logout (mobile also gains Feed and Corrections here, since neither has its own bottom-nav tab).',
    ],
    actions: ['Coordinates "only one popover open at a time" through the activePopover nanostore (src/lib/stores/ui.ts) rather than local state per island.', 'Listens for the `e` key and the window `open-record-event` CustomEvent (fired by BottomNav\'s FAB) to open the Record-event modal.'],
    feedback: ['Mobile (≤767px): scratchpad and todo triggers are hidden entirely — the Tasks tab and the avatar sheet cover them (docs/design/mobile-shell.md); the bell and avatar open as bottom sheets instead of anchored popovers.'],
    docs: [SCREENS, MOBILE_SHELL, 'src/components/shell/HeaderActions.svelte'],
  },
  {
    name: 'Sidebar.astro',
    selector: '.sidebar',
    purpose: 'Desktop persistent navigation — Home, Tasks, and this term\'s courses always one click away, with standing/collapsed states remembered.',
    affordances: [
      'Navigate to Home, Tasks, or any current-term course (hue-tinted left rail when active).',
      '"+ Add course" (always visible).',
      'Expand "Past terms" for archived-term courses.',
      'Footer: Feed, Corrections, Settings, and a collapse toggle (60px monogram-chip rail when collapsed).',
    ],
    actions: [
      '"+ Add course" dispatches a window `open-add-course` CustomEvent (AddCourseModal listens) rather than owning the modal itself.',
      'Collapse toggle stamps `data-sidebar="collapsed"` on <html> and persists it to localStorage (`sb:sidebar`) / settings.sidebar_collapsed.',
    ],
    feedback: ['`display: none` below 767px — the mobile shell replaces this entirely with BottomNav + the avatar sheet (no drawer).'],
    docs: [SCREENS, MOBILE_SHELL, CHARTER, 'src/components/shell/Sidebar.astro'],
  },
];
