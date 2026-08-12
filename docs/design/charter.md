# studyus theme charter

Binding synthesis of the compass / campus / focus design debate (2 rounds).
This document is the contract for the implementation wave: shared-structure
changes are mandatory and theme-neutral; per-theme work is token-values only.
Themes share identical DOM/layout — they vary fonts, colors, spacing, motion,
radius, and shadow (all token-owned), never structure.

## 1. The three feels

**Compass — minimal, clean, informational.** Compass is a quiet instrument,
not a poster. Ink is earned by data that changes a decision — grades, overdue
dates, mastery % — never by decoration or by structure repeating itself.
Whitespace is the primary hierarchy tool; rank matters more than
emphasis-by-color. Numbers are the heroes: the largest, calmest, most
confident marks on the page, set in tabular figures with room to breathe.
Everything else — kickers, pills, borders — is quiet infrastructure that
recedes the instant you stop needing it. Shadow is literally absent; structure
is drawn with hairlines and space, not elevation.

**Campus — comfortable, historical, homely.** Campus should feel like a worn
library table with your own notebook, not software. Warmth comes from paper
(cream/oatmeal, never gray-beige), ink (warm brown-black, never pure black),
and type (Fraunces' soft curves doing real work on titles and hero numbers,
not confined to page `<h1>`s). "Historical/collegiate" means the vocabulary of
a lecture hall and reading room — running heads, brick-binding red — with zero
heraldry or faux-antique kitsch. Softness stops at the data boundary: grades,
percentages, and dates stay high-contrast and instantly scannable; warmth is
delivered through frame, color, and voice around the numbers, never by
softening the numbers themselves. Separation is shadow-led (warm, raised),
never hairline-led.

**Focus — modern, hyperfocus, sharp.** Focus is a command-center for deep
work, not a reading experience. Chrome — nav, labels, borders — recedes to
peripheral vision; foveal attention goes to numbers: grades, deadlines, time.
Density is more signal per glance, not clutter. Space Grotesk is the theme's
one flourish and should land exactly where the eye needs to go — stat
numbers, course codes — so its appearance itself signals "important."
Tabular figures let a column of grades be scanned without re-reading each
row. Exactly one glowing, full-saturation accent lives on a screen at a time;
course hues and other color must never compete with it. Radius stays cut,
motion stays snappy.

## 2. Consensus rules (binding, theme-neutral)

**Course-color cap.** Course hue is capped at exactly one full-chroma
*shape* (border, stroke, fill, dot, background wash) per card/row. All other
shapes in that card/row that need to signal "this is course X" use
`var(--course-soft)` or no course color at all. Typographic uses of
`var(--course-ink)` on small labels (course code, monogram) don't count
against the cap — they're legibility, not a color block — but a component
still may not stack a second full-chroma *shape*. SHAPE + INTENSITY of the
one mark are theme-owned (compass: top strip; focus: thin border/tick;
campus: highlighter-tab wash) — no new tokens required, this is a component
discipline rule applied through the existing `--course` / `--course-soft`
pair.
- Exception: task rows showing multiple course affiliations (`TaskItem.svelte`
  `.course-dots`) are exempt — each dot is a distinct course's identity mark,
  not a repeated signal for one course.
- Fix `CourseCards.astro` (`src/components/dashboard/CourseCards.astro`): the
  top border strip is the one mark; `.mastery .bar > span` must stop reading
  `var(--course)` and use `var(--accent)` instead — mastery is a progress
  metric, not identity, and doubling the course hue onto the bar duplicates
  the strip.
- Fix `WeekView.svelte` collapsed chip (`.chip-evt`): currently carries
  border-color, background wash, *and* a colored `.dot` — three course-hue
  touches. Drop the `.dot`; border + soft background (the same pattern
  `WeekGrid.svelte`'s `.event-block` already uses correctly) is the target.
- `WeekGrid.svelte` event blocks and all-day pills, `Sidebar.astro` course
  rail/monogram, and `ResourceCard.svelte` course chip are already compliant
  (one shape or zero) — no changes needed there.

**Signal-collapse.** One visual signal per fact. `StatusChip.astro` (single
pill, one status) is the model to match elsewhere. Where a genuine duplicate
exists — the same fact rendered twice in the same row/card — collapse it.
Concretely: the `WeekView.svelte` chip fix above is a signal-collapse instance
too (dot and border both said "course X"). The implementation wave should
audit `CourseCards.astro`'s header (course-color strip + code + status pill)
and confirm each element carries a *different* fact (identity via strip/code,
mastery status via pill) before leaving it alone — don't collapse signals
that aren't actually duplicates.

**Number hierarchy.**
- New `.figure` class in `base.css`: hero numbers (grades, weighted %, big
  stats) — large, `--weight-semi`+, tabular-nums, themeable face.
- `.num` (`base.css:36`): `font-family: var(--font-num, var(--font-body))`.
- `.kicker` (`base.css:203`): `font-family: var(--font-kicker, var(--font-body))`.
- New `.card-title` hook: `font-family: var(--font-title, var(--font-display))`.
  Apply to non-heading title elements that should carry a display/serif face
  — e.g. `CourseCards.astro` `.title` (the course name span, currently plain
  body text). Actual `<h1>`–`<h6>` already default to `--font-display` via
  `base.css:28` and need no change.
- Hour labels (`WeekGrid.svelte` `.hour-tick .num`) and grade numbers
  (`CourseCards.astro` `.grade-num.num`) are already on `.num` — verify they
  inherit the new `--font-num` var correctly after the base.css edit. Any
  other percentage/count label found lacking `.num` during implementation
  (e.g. a course-detail "mastery by branch" list, not in the reviewed file
  set) should be brought onto `.num` under this same rule.

**Spacing/motion hygiene** (`base.css`):
- `.card` padding: `20px` → `var(--space-5)`.
- `.card-head` margin-bottom: `14px` → `var(--space-4)`.
- `.bar > span` transition: `width 0.7s cubic-bezier(...)` → `width var(--motion-base) var(--ease)`.
- Sweep any other hardcoded px/ms found in `base.css` onto the matching
  token (e.g. `.icon-btn` 34px, `.pop-w` fallbacks stay as-is — those are
  structural sizing, not motion/spacing rhythm, and are out of scope).

**Planner now-line.** `WeekGrid.svelte` `.now-line` currently hardcodes
`var(--danger)`. Replace with `--now-line-color` (default: `var(--danger)`)
and add `--now-line-glow` (default: `none`) applied as a `box-shadow`/
`filter: drop-shadow` on `.now-dot`/`.now-line`. Defaults preserve current
behavior for compass/campus; focus opts into an accent + glow ring.

**Sidebar active state.** `Sidebar.astro` `.nav-item.active` keeps
`background: var(--sidebar-active-bg)` as the universal base affordance. Add
`--nav-active-tick` (default `0`, i.e. no tick) as a `border-left-width` (or
equivalent) on `.nav-item.active`; only focus sets it to a nonzero value.

**Settings swatches.** `AppearanceSettings.svelte`'s `.swatch` preview
currently only shows bg/surface/accent color blocks. Add a small "Aa" glyph
inside `.preview`, styled `font-family` from each theme's actual
`--font-display` (or `--font-title`) value — not the hardcoded hex strings
already in the `THEMES` array, which stay for the color blocks.

**Theme-owned, not to be unified:**
- Shadow character/strength is theme-owned — `none` (compass) through
  `strong warm` (campus) are all valid; motion tokenization must not force
  matching speeds across themes; there is no shared font-weight clamp (focus
  700 on numbers is its identity, compass's 650 cap applies to compass only).

## 3. Per-theme briefs (token-value work only)

**compass** (`src/styles/themes/compass.css`): add `--text-figure`/`.figure`
sizing (~32px, `--weight-semi`, tabular); recess hairline further from
border (`--hairline` → ~94.5% L); widen dark-mode surface/border separation
(`--surface` → ~25% L, `--border` → ~36% L) without touching `--bg`; now-line
stays calm (`--now-line-glow: none`); course mark = top strip, full chroma
allowed as the sole carrier; empty-state copy stays dry/neutral.

**focus** (`src/styles/themes/focus.css`): `--font-num: var(--font-display)`
(Space Grotesk on numbers); radii 8/6/4; `--course-c: 0.05` (desaturate
course hue below the accent); `--accent-glow` for dark-mode primary CTA;
now-line gets accent color + glow ring; number weight 700; `--nav-active-tick`
opts in to a nonzero value; `--motion-base` ~140ms (snappiest of the three).

**campus** (`src/styles/themes/campus.css`): `--font-num` and `--font-title`
both Fraunces; `--font-kicker` Fraunces italic or small-caps treatment;
separate `--bg`/`--surface` more (desk ~95% L under paper ~97.5% L, both
warm-hued, not flat beige); stronger warm shadows (brown-tinted, visible
alpha) as the primary separation mechanism; dark-mode candle-glow values on
`--accent-soft`/`--surface-2`; course mark is near-full-chroma as the single
carrier styled as a highlighter-tab wash behind the title; motion ~220ms,
gentlest of the three.

## 4. Vetoes honored

- **Compass:** `--shadow-card: none` stays literal — no forced elevation.
  No second simultaneous status/identity signal added to a card/row beyond
  the one-shape course rule.
- **Focus:** number weight stays 700 — no shared weight clamp. No whitespace
  creep once `.card` padding tokenizes — focus keeps the tightest values.
- **Campus:** shadow-led separation is non-negotiable — hairline must not
  become the primary structural device. No numeric chroma clamp forced onto
  campus's course mark. Fraunces must land on card titles and hero numbers,
  not just page headings — this was campus's most load-bearing ask.

## 5. Moderator rulings

1. **Course-color mechanism**: no new dedicated tokens (`--course-mark-*`)
   are needed — the existing `--course`/`--course-soft`/`--course-ink` pair
   already supports the cap; the rule is a component-discipline constraint
   (max one full-chroma shape per card/row), documented above with the two
   concrete violations found in current code (`CourseCards.astro` mastery
   bar, `WeekView.svelte` chip dot). Simpler than minting per-theme carrier
   tokens, and it doesn't require touching theme files to enforce.
2. **Typographic course-ink vs. the cap**: ruled that small legible text uses
   (course code labels, monograms) don't count toward the one-shape cap —
   only color-blocking shapes do. This keeps the rule enforceable without
   forcing course codes to go gray.
3. **Sidebar tick**: compass's objection to a *mandatory* tick is upheld —
   `--nav-active-tick` defaults to `0`; only focus opts in. Campus's soft
   fill stays the unconditional base affordance for all three.
4. **Now-line default**: `--now-line-color` defaults to `--danger` (matches
   current shipped behavior for compass/campus, zero visual regression);
   `--now-line-glow` defaults to `none`; focus is the only theme that changes
   both.
5. **Task-row course dots**: ruled exempt from the course-color cap — they
   represent multiple distinct course affiliations on one row, which is a
   different situation from a single card/row repeating one course's hue.
6. **Header/dashboard triple-signal claim**: on inspection of the actual
   component (not the assumed prototype), `CourseCards.astro`'s top
   strip + code + status pill encode three *different* facts (identity via
   color, identity via text, mastery status), not one fact three times — so
   no forced collapse there; only the mastery-bar/course-hue duplication is
   a real fix.

## 6. Implementation notes

**Shared files (theme-neutral, do first):**
- `src/styles/base.css` — `.figure`, `.num`/`.kicker` font hooks, `.card-title`,
  spacing/motion token sweep.
- `src/components/dashboard/CourseCards.astro` — mastery bar color, `.title`
  → `.card-title`.
- `src/components/dashboard/WeekView.svelte` — drop `.chip-evt .dot`.
- `src/components/planner/WeekGrid.svelte` — `--now-line-color`/`--now-line-glow`.
- `src/components/shell/Sidebar.astro` — `--nav-active-tick`.
- `src/components/settings/AppearanceSettings.svelte` — "Aa" glyph in swatch preview.

**Theme files (token-values only, do second):**
- `src/styles/themes/compass.css`, `focus.css`, `campus.css` — per-theme
  briefs in §3. No structural/markup changes permitted in this pass.

**Verification checklist:**
- [ ] Grade/weighted-% numbers render in three visually distinct faces
      across compass/focus/campus (body sans / Space Grotesk / Fraunces).
- [ ] Each dashboard course card and each planner event block shows at most
      one full-chroma course-colored shape; all other course-hue touches are
      soft or absent.
- [ ] `.card` padding and `.card-head` margin visibly differ across themes
      (space tokens are actually driving them, not a shared hardcoded value).
- [ ] Planner now-line is calm in compass/campus, glowing accent in focus.
- [ ] Sidebar active course/nav item shows a left tick only in focus.
- [ ] Settings swatches show each theme's real display/title font in the "Aa".
- [ ] Compass has zero box-shadow on cards; campus has a visibly warm,
      raised shadow; focus's shadow (if any) is short/structural.
- [ ] `prefers-reduced-motion` still collapses all transitions to ~0
      (base.css's existing media query untouched).
