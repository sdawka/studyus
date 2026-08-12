# Focus theme

Dense, sharp, indigo command-center. Focus is the theme for someone who
wants the interface out of the way and the numbers in front of them. Chrome
— nav, labels, borders — recedes to peripheral vision; foveal attention goes
to numbers: grades, deadlines, time. Density is more signal per glance, not
clutter.

## Voice

Confident, efficient, a little cold. No warmth-through-roundness, no
generous whitespace — clarity comes from contrast and alignment, not air.
If compass is a calm workspace and campus is a warm notebook, focus is a
cockpit.

## Type

- Display: **Space Grotesk Variable** — geometric, slightly technical,
  the theme's one flourish. It lands exactly where the eye needs to go —
  `--font-num: var(--font-display)` puts it on stat numbers and `.figure`
  hero numbers (grades, weighted %), and `--font-kicker: var(--font-display)`
  puts it on course codes and uppercase labels via `.kicker`. Headings get it
  through the base `--font-display` default. Everywhere else stays Inter, so
  Space Grotesk's appearance itself signals "important" — it never becomes
  wallpaper.
- Body: **Inter Variable** — a neutral, highly legible workhorse for
  copy, tables, and labels. Base size stays 13px, same as the other themes.
- Weight is a tool for hierarchy: `--weight-bold` runs to 700 so headings
  and hero stats read as unmistakably heavier than body text — this is
  focus's identity and isn't clamped to match compass's 650 cap.
  `--tracking-caps` is tightened to 0.06em — enough presence on uppercase
  labels without feeling loose. Base size is 13px — smaller than compass
  (15px) or campus (15.5px), on purpose: focus trades reading comfort for
  density, matching its "cockpit, not a calm workspace" voice.
- `--text-figure: 28px` sizes `.figure` hero numbers — dense but still the
  most prominent mark on the page, tabular-nums, `--weight-semi`+.

## Color

A cooler, more saturated indigo than the other themes' accents
(`oklch(52% 0.19 267)` in light, `oklch(64% 0.155 268)` in dark — vivid
without tipping neon). Neutrals share that same cool blue-violet hue
(264) instead of a true gray, so borders, muted text, and surfaces all
lean the same direction as the accent. Text-to-muted contrast is pushed
higher than the other themes so scanning a dense table doesn't require
close reading — the important number should be findable at a glance.

Exactly one glowing, full-saturation accent lives on a screen at a time.
Course hues are desaturated well below it — `--course-c: 0.05` (down from
0.07) — so a dashboard full of course-colored cards never competes with
the accent for attention; course identity is still legible (the one
full-chroma mark per card/row that the course-color cap allows), it just
never reads as loud as the accent.

`--accent-glow` gives the dark-mode primary CTA an actual glow ring
(`0 0 12px oklch(64% 0.155 268 / 0.35)`) instead of a flat fill — the one
thing that should glow, glows. It's `none` in light mode, where a glow
would just look like a shadow smear against a light surface. This token
isn't consumed yet by `.btn-primary` in `base.css` (shared file, out of
this pass's scope) — wiring `box-shadow: var(--accent-glow, none)` there
is the remaining step to make it visible.

## Density

The tightest spacing and radii of the three themes: `--space-6` is 24px
(vs. a roomier default elsewhere), `--radius-lg/md/sm` are 8/6/4px.
Corners read as "cut," not "rounded." Shadows are short and close to the
surface (`--shadow-card` / `--shadow-pop`) rather than soft and floating —
depth should feel structural, not decorative.

## Wayfinding

The planner's now-line is the cockpit's most important anchor, so it's the
one theme that makes it glow: `--now-line-color: var(--accent)` (instead of
the shared default `--danger`) plus `--now-line-glow`, a soft accent ring
(`0 0 0 3px` accent at ~0.18–0.22 alpha depending on scheme) applied to both
the line and the now-dot. The sidebar's active nav item gets a left tick
(`--nav-active-tick: 2px`) on top of the universal background tint that all
three themes share — focus is the only theme that opts into the tick.

## Motion

Snappiest of the three: `--motion-fast` 90ms, `--motion-base` 140ms, with
a decisive ease-out curve (`cubic-bezier(0.22, 1, 0.36, 1)`). Things
should feel like they respond instantly, not glide.

## Dark mode

Focus's dark scheme is the one meant to hold up best under real use: a
deep, cool near-black `--bg`, with `--surface` and `--surface-2` stepped
clearly apart so cards and panels are legible without borders doing all
the work. The pinned-dark sidebar is focus's identity — it stays the
same rail color in both light and dark schemes, deliberately not
"whichever scheme is active."

## Do

- Let Space Grotesk carry headings, stat numbers, and course codes.
- Keep spacing tight; resist the urge to add breathing room "for balance."
- Trust the higher text/muted contrast for dense tables and lists.

## Don't

- Don't soften radii or shadows to make focus feel friendlier — that's
  a different theme's job.
- Don't let the sidebar rail shift between schemes; it's pinned on purpose.
- Don't slow the motion timings down to match the other themes.
