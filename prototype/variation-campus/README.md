# StudyBuddy — "Warm Campus Cards" prototype variation

A static, self-contained UI variation for StudyBuddy exploring a friendlier, warmer
visual direction than the existing prototypes in `prototype/`. Four pages, inline
CSS, minimal vanilla JS, no build step, no external assets or CDNs — open any
`.html` file directly in a browser.

## Design direction

**Warm campus cards**: soft rounded cards on a warm cream/parchment background,
gentle shadows for depth, a friendly rounded display typeface for headings
(`ui-rounded` with system fallbacks), and a medium type scale that reads as
approachable without tipping into childish. Motivational language stays purely
informational — "3 of 16 concepts mastered," "92% attendance" — never streaks,
badges, or nagging copy.

### Key moves

- **Per-course color system.** Each course gets one HSL hue, set once per element
  via a `--h` custom property and reused everywhere that course shows up: calendar
  chips on the dashboard, mastery/progress bars, course card accents, feed tags,
  and filter chips. The same hue always maps to the same course across all four
  pages, so a learner can visually track a course without reading the code every
  time (e.g. Fluid Mechanics is consistently blue, Biotechnology consistently
  green).
- **Cards over tables.** Nearly everything — deadlines, grades, courses, concept
  branches, resources — renders as a soft-cornered card (`20px`/`14px`/`10px`
  radius tiers) with a subtle warm-toned shadow, rather than dense rows or plain
  lists. Cards use a light accent border-top or border-left in the course hue to
  tie color to structure.
- **Real course data.** All course codes, titles, instructors, branches, and
  concepts are pulled from `courses/courses.json` (McGill ChemEng courses).
  Grades, attendance, and mastery counts are illustrative mock values layered on
  top of that real structure — the goal is a believable "how am I doing" reading,
  not real transcript data. Feed links are genuine canonical/geek-feed URLs from
  the same file.
- **Purely informational framing.** Progress is always shown as a fraction or
  percentage tied to a concrete referent ("11 of 12 lectures," "3 of 16 concepts
  mastered," "78% weighted standing") — never a streak counter, level, or
  congratulatory toast. The one exception is a quiet, non-modal confirmation
  toast after recording an event or logging attendance, which just confirms the
  action happened.
- **Shared nav shell.** All four pages repeat the same top nav (StudyBuddy brand
  mark, Dashboard / Courses / Study / Feed) so the set reads as one product, not
  four disconnected mocks.
- **Theme-aware.** Each page ships both a `prefers-color-scheme: dark` block and
  explicit `[data-theme="dark"]` / `[data-theme="light"]` overrides, so the warm
  palette holds together in light and dark viewing contexts.

## Pages

- **`dashboard.html`** — 7-day deadline strip with course-colored event chips,
  a grade snapshot row, a "due soon" list with urgency pills, a mini course grid
  with mastery bars, and a "Record event" card (course → event type → date) that
  confirms on submit.
- **`course.html`** — Standing view for CHEE 314 (Fluid Mechanics): weighted
  grade tile, attendance tile with one-tap "mark attended/missed" buttons,
  concept-mastery tile, an assessments list, expandable concept branches (all
  five real branches, each concept tagged mastered/practicing/not-started), and
  an upcoming-deadlines rail. A course-switcher strip at the top hints at moving
  between courses.
- **`study.html`** — A four-step wizard: pick a course → pick a duration (25/45/
  60/90 min) → pick a session type (retrieval practice, worked examples, reading,
  quick quiz) → review a summary and start. Purely a flow mock; "starting" just
  reveals a confirmation state.
- **`feed.html`** — Curated resources (real canonical + geek-feed links per
  course, tagged and color-coded) plus a "Shared by you" section, a course
  filter strip, and an inline "Add resource" form that appends to the shared
  section (persisted to `localStorage` for the session).

## Notes for whoever picks this up

- Colors, radii, and shadows are defined as CSS custom properties at the top of
  each file's `<style>` block; the per-course hues are declared once in each
  page's JS `COURSES` array and should stay consistent if this direction is
  carried into the real app.
- No framework, no external fonts/icons — icons are inline SVG, fonts are system
  stacks.
