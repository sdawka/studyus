# Variation: Focus Tool

A dense, keyboard-era productivity aesthetic for StudyBuddy — closer to Linear or Things than a typical "edtech" dashboard. The goal is a tool a student reaches for many times a day without friction, not a showcase.

## Key moves

- **Compact dark-neutral sidebar.** Fixed 212px sidebar (`#18181c` / `#0e0e10` dark) holding the two nav groups from the plan — Admin (Dashboard/Calendar/Grades) and Learning (Feed/Courses/Study/Notes/Tasks/Profile). Unbuilt routes are shown, dimmed, tagged "soon" — the shell communicates the full app shape even though only 4 pages exist here.
- **Single restrained accent.** One indigo (`#5b5bd6` light / `#7373e0` dark) used sparingly: primary buttons, active nav state, links on hover, chart bars. Everything else is neutral gray-on-white (or near-black in dark mode).
- **Borders over shadows.** Cards are `1px solid` bordered, not shadowed. No blur, no gradients. Density comes from tight padding (10–14px) and a small type scale (10.5–18px), not whitespace.
- **Crisp status chips for KC mastery.** Four consistent pill states — not-started (gray), learning (indigo), review (amber), mastered (green) — each with a colored dot + label, reused identically on the dashboard streak card and the course Standing tab's concept-mastery-by-branch view.
- **System font stack only**, no webfonts. `-apple-system, "Segoe UI", Roboto...` at 13px body / 11–12.5px UI text, with uppercase 10.5px tracked labels for field names and section metadata — a Linear-style typographic signature.
- **Light and dark aware.** Everything is driven by CSS variables and a single `prefers-color-scheme: dark` media query per page; no separate dark build.
- **Motivational but informational.** No mascots, streak-fire emoji, or celebratory copy — progress shows up as a streak stat, a trend arrow, and mastery chips, and that's the whole "motivation" layer.

## Pages

- `dashboard.html` — 7-day deadline strip (task/exam dots per day), grade snapshot table with trend deltas, weekly stat row, due-tasks list with toggleable checkboxes, and a quick inline "record event" card. The sidebar's `+ Record event` button (bound to `E`) opens the same action as a global modal, matching the plan's "Global Record event modal in nav."
- `course.html` — CHEE 314 (Fluid Mechanics) Standing tab: weighted grade / attendance % / graded-so-far / KCs-tracked hero stats, assessment table with per-item weight and grade (pending items flagged), one-tap attendance log per lecture, concept mastery chips grouped by the course's real branches (Foundations, Macroscopic balances, Porous/particle systems, Microscopic balances), upcoming deadlines, and a manual-event-editable recent events list.
- `study.html` — Course → duration (pill choices) → session type (practice / retrieval practice / reading / quick quiz cards) → a real mocked countdown timer with pause/finish → a completion screen showing KCs touched and an optional reflection field. Implemented as a 3-step state machine in vanilla JS (no page reload).
- `feed.html` — Curated (canonical + geek-feed) resources across 6 real courses, functional client-side course filter chips, pin/star toggle, an inline "share a resource" form, and a stub linking into the Study flow (the plan's "study-session-organizer stub").

## Data

All course codes, titles, instructors, branches, and concept/resource names are pulled directly from `courses/courses.json` (CHEE 314, CHEE 370, CHEE 315, CHEE 351, CHEE 310, MATH 264) — no placeholder Lorem Ipsum course data. Grades, attendance percentages, and event timestamps are illustrative mock values layered on top of that real structure.

## Notes

- Fully self-contained: inline CSS per page (duplicated intentionally so each file stands alone), no external assets, fonts, or CDNs.
- Vanilla JS only: nav/filter state, modal open/close, checkbox toggles, pill/card selection, and the study timer state machine.
- Cross-linked via a shared sidebar (`dashboard.html`, `course.html`, `study.html`, `feed.html`); unimplemented nav items (Calendar, Grades, Notes, Tasks, Profile) are visible but inert.
