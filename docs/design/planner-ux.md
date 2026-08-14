# Planner Week-View UX Spec

Distilled from Notion Calendar, Fantastical, Amie, Structured, Vimcal/Rise, Google Calendar,
and Todoist/Things. Opinionated, implementable, student-focused.

## 1. Week time-grid anatomy

- **Hour gutter**: 56px wide, right-aligned labels, 12-hour format (`9 AM`), one label per
  hour tick only (no half-hour labels — keep the gutter quiet).
- **Day columns**: 7 equal-width columns on desktop (≥1024px); collapse to a 3-day rolling
  window on tablet, 1-day on mobile. Do NOT lock to Sun–Sat — always show the current day in
  a fixed visual slot (leftmost on mobile/3-day, natural position on 7-day) so "today" never
  jumps around. **Implemented** (mobile-shell wave, 2026-08-14): `WeekGrid.svelte` measures its
  own rendered width via `bind:clientWidth` — container-measured, not viewport-media-queried,
  since it renders inside both the fixed planner/tasks overlay layer and the dashboard's
  compact inline instance — and sets `dayCount = width < 480 ? 1 : width < 760 ? 3 : 7`.
  `PlannerView.svelte` owns a `dayAnchor` state (default: today) passed down as `anchorDate`;
  below 7-day mode, `WeekGrid` renders `dayCount` consecutive days starting at that anchor (a
  rolling window, never locked to Sun–Sat) so the anchor day is always the leftmost column, per
  this spec.
- **All-day row**: pinned strip above the hour grid for all-day items and **deadlines**
  (assignment due dates render here, not as zero-duration timed blocks — students scan this
  row first).
- **Now-indicator**: 2px red/accent horizontal line across all day columns at current time,
  with a small circular dot at the left edge; updates every 60s; only rendered on the column(s)
  containing "now."
- **Time bounds**: auto-fit to the earliest-start/latest-end of the day's events, clamped to a
  **hard floor of 6 AM and ceiling of 11 PM** (never auto-shrink below a 12-hour visible span —
  a nearly-empty student day should still look like a day, not a sliver). Default view on load:
  8 AM–8 PM, scrolled so 8 AM is at the top.
- **Hour height**: 64px per hour at default zoom (1px ≈ 0.94min). Support a compact density
  toggle at 48px/hour for users who time-block heavily.
- **Snapping**: drag/resize snaps to 15-minute increments; hold no modifier for free placement
  — 15 min is the right default granularity for study sessions (5 min is too fussy, 30 min is
  too coarse for a 25-minute Pomodoro block).

## 2. Event block design

- **Color coding**: color = course/category, assigned automatically from a fixed palette
  (don't let students hand-pick per event — decision fatigue). Reserve one neutral gray for
  "personal/unassigned." Add a 2px left-border accent plus a small icon (book, flask, clock)
  as a colorblind-safe secondary signal — never rely on hue alone.
- **Density**: default block shows title + time range if height ≥ 32px; below that, title only,
  truncated with ellipsis, no time range (there's no room and it's noise).
- **Min-height**: 24px minimum rendered height regardless of actual duration, so a 15-minute
  block is still tappable/readable. Sub-24px durations still get the full 24px box; don't let
  the grid math shrink it further.
- **Overlap layout**: classic interval-graph greedy coloring. Sort overlapping events in a day
  by start time; assign each to the first free column (first-fit); all events in a mutually-
  overlapping cluster share equal column width; max concurrent overlap in the cluster = column
  count. This is O(n log n), deterministic, and matches what Google Calendar/Vimcal do — don't
  invent a novel layout.
- **Hover card** (desktop) / **tap preview** (touch): title, time range, course/category chip,
  location if present, first line of notes, and a "due" badge if it's a deadline-linked block.
  Appears after ~200ms hover delay, dismiss on mouse-leave.
- **Selected state**: 2px accent-colored outline + subtle elevation shadow; do not change the
  fill color (that's reserved for category) — selection is a border/shadow treatment only.

## 3. Navigation

- **Today button**: always visible in the header, left of the date range label; disabled
  (visually muted) when the current view already contains today.
- **Week paging**: `‹` / `›` chevrons flanking the date range; clicking pages by exactly 7 days
  (not "next visible week" — keep math simple and predictable).
- **Keyboard**: `t` = jump to today, `←`/`→` (or `j`/`k`) = page week backward/forward,
  `Esc` = close any open popover/detail panel and return focus to the grid. Keep shortcuts
  active by default (unlike Google Calendar's opt-in toggle) but show a one-time `?` hint
  affordance in the header the first session.
- **Mini-month jump**: small month calendar in the sidebar/header dropdown; clicking a date
  jumps the week view to contain that date, highlights it. This is the fastest way to jump
  >2 weeks away — don't make users click chevrons repeatedly.
- **Date header**: each day column header shows weekday abbreviation (top, small, muted) +
  day number (large, bold). Today's number gets a filled circular badge in the accent color.
  Weekend headers get no special treatment beyond normal styling (see §6 — don't gray them out).

## 4. Sidebar / agenda pairing

- Persistent right rail (desktop) / collapsible drawer (mobile) listing **unscheduled tasks**
  and **upcoming deadlines within 7 days**, grouped by "Overdue," "Due today/tomorrow," "This
  week" — mirrors Todoist's Plan sidebar pattern, which is the right model for students juggling
  assignments across courses. **Mobile note** (mobile-shell wave, 2026-08-14): the rail
  (`PlannerRail.svelte`, under a "Plan ahead" heading) isn't a collapsible drawer below 767px —
  it stacks below the main grid/agenda/month view via the pre-existing `@media (max-width:
  1100px)` single-column rule (`PlannerView.svelte`'s `.planner-body`), same as the tablet band.
  The mobile-shell wave's actual scope for Planner was WeekGrid's day-count, the Agenda default,
  and sheet-based popovers (see plan Part 2) — it didn't build the drawer this spec originally
  called for; revisit if the always-stacked rail proves too far down the scroll on phones.
- Each rail item shows course chip + title + due date; overdue items get a red left-border.
- **Drag-to-schedule from rail onto the grid is in scope but can ship in a follow-up phase** —
  the v1 cut is: click a rail item → opens the same create/edit panel used for grid clicks,
  pre-filled with the task's title/course, user picks a time. Full drag-and-drop (auto-fills
  date+time+duration on drop, like Todoist) is the natural v2 once the click-to-schedule flow
  is validated. Don't block v1 on building DnD.

## 5. Interaction

- **Click an existing event** → popover anchored to the block (desktop) or bottom sheet
  (mobile) with Edit / Delete actions and the hover-card fields; Edit opens the full detail
  panel inline in the popover for simple fields (title, time) and routes to a full panel for
  notes/attachments.
- **Click an empty slot** → immediately opens a lightweight inline create form at that
  position, pre-filled with a 30-min duration starting at the clicked (snapped) time. Don't
  make users open a separate modal for the common case.
- **Deep-linking**: support `?event=<id>` in the URL. On load with this param: fetch the event,
  scroll the grid to its week/time, open its detail popover automatically, and highlight the
  block with the selected-state outline. This makes notification links and "jump to this
  deadline" links from other parts of the app work correctly.

## 6. Visual hierarchy — do / don't

- **Do** dim past events within *today* (reduce opacity to ~60%) so the eye goes to what's
  still ahead. **Don't** dim entire past days in the week view — a student reviewing last
  Tuesday's study session needs it at full legibility.
- **Do** give weekends a subtly different (slightly lighter/cooler) column background if the
  app expects most academic activity Mon–Fri — a *background* tint only, never grayed-out text
  or reduced opacity on weekend events themselves.
- **Do** cap the active category/course palette at 8–10 colors; beyond that, colors stop being
  distinguishable at a glance, which defeats the point.
- **Don't** use color alone to distinguish deadline vs. class vs. study-block *type* — use shape
  language too (deadlines = pill in all-day row, classes = solid block, self-scheduled study
  blocks = block with a subtle diagonal-stripe or dashed-border texture).
- **Don't** show gridlines darker than the events themselves — the grid is scaffolding, events
  are content; keep hour-line strokes at low contrast (e.g., 8-10% opacity over background).

## 7. What makes it feel "award-winning"

- **Micro-transitions**: week paging animates as a horizontal slide (150-200ms ease-out), not
  a hard cut — reinforces the spatial model that time moves left-to-right. Event
  create/delete fades+scales (120ms) rather than popping instantly. Keep everything under
  250ms; anything longer feels sluggish, not polished.
- **Empty states**: an empty day should feel intentional, not broken — a soft illustration or
  a single muted line ("Nothing scheduled — tap any time to add a study block") rather than a
  blank white column. This is where Structured and Amie both invest disproportionately and it
  pays off in first-run impressions.
- **Typography in the grid**: use a slightly condensed, high-legibility numeral style for times
  (tabular figures so times align vertically), and keep event-block title type one weight
  bolder than body text elsewhere in the app — the grid is dense, so type has to carry
  hierarchy that whitespace can't.
