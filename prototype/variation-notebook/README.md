# Variation: Paper Notebook

A calm, academic take on the StudyBuddy UI — the app should feel like a well-kept lab notebook, not a dashboard trying to gamify your semester.

## Key moves

- **Paper, not screen.** Off-white background (`#f8f4ea` page / `#f3eee1` shell), with content blocks rendered as "sheets" that carry a faint horizontal rule pattern (`repeating-linear-gradient`, 28px rhythm) and a thin vertical margin line in dusty red — the two motifs of ruled paper, done in CSS only, no images.
- **One ink color.** A single desaturated blue (`#2b4a6b`) does every job an accent color needs: active nav state, progress bars, links, buttons, focus rings. No second or third accent competing for attention.
- **Serif throughout.** A Charter/Georgia/Iowan Old Style stack is used for everything — headings, body copy, buttons, form fields — for a bookish, unhurried register instead of a UI-chrome sans-serif.
- **Margin notes, not toasts.** Where the UI needs to editorialize (e.g. "two assessments still ungraded," "attendance derived from what's logged"), it does so in a small italic aside along a dashed left border, styled like a handwritten annotation in the margin — never a banner, badge, or confetti moment.
- **Facts, not encouragement.** All progress is stated numerically and plainly ("74% weighted standing," "22 of 24 lectures," "two courses have no graded work yet"). No streaks, no congratulatory copy, no color-coded shame — status colors (a muted green/amber) are used sparingly and only to mean "solid" vs. "needs review."
- **Real course data.** Course codes, titles, branches, and concepts are pulled from `courses/courses.json` (CHEE 314, CHEE 310, CHEE 315, CHEE 351, MATH 264, CHEE 380, etc.) rather than placeholder text.

## Pages

- `dashboard.html` — 7-day deadline strip (ruled week grid), grade snapshot across courses, due-tasks list, and a "record an event" affordance for logging things that happened outside the app.
- `course.html` — CHEE 314 (Fluid Mechanics) Standing view: weighted grade headline, attendance record with one-tap log buttons, assessment table with inline grade entry, concept mastery grouped by course branch, and upcoming deadlines for the course.
- `study.html` — a 4-step wizard (course → duration → session type → session) for starting a study block, ending in a mock running session that appends an event on "Finish."
- `feed.html` — curated resources per course (drawn from each course's `canonical`/`feed` links) with a course filter, plus a "shared by course-mates" section and a lightweight add-link form.

## Implementation notes

Each page is fully self-contained (inline `<style>`, inline vanilla `<script>`, no external fonts/CDNs/assets) and shares the same top nav for cross-linking between pages. No build step — open any `.html` file directly in a browser.
