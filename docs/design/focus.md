# Focus theme

Dense, sharp, indigo command-center. Focus is the theme for someone who
wants the interface out of the way and the numbers in front of them.

## Voice

Confident, efficient, a little cold. No warmth-through-roundness, no
generous whitespace — clarity comes from contrast and alignment, not air.
If compass is a calm workspace and campus is a warm notebook, focus is a
cockpit.

## Type

- Display: **Space Grotesk Variable** — geometric, slightly technical,
  used for headings, stat numbers, and course codes. It's the one place
  focus announces itself; everywhere else stays quiet.
- Body: **Inter Variable** — a neutral, highly legible workhorse for
  copy, tables, and labels. Base size stays 13px, same as the other themes.
- Weight is a tool for hierarchy: `--weight-bold` runs to 700 so headings
  and hero stats read as unmistakably heavier than body text.
  `--tracking-caps` is tightened to 0.06em — enough presence on uppercase
  labels without feeling loose.

## Color

A cooler, more saturated indigo than the other themes' accents
(`oklch(52% 0.19 267)` in light, `oklch(64% 0.155 268)` in dark — vivid
without tipping neon). Neutrals share that same cool blue-violet hue
(264) instead of a true gray, so borders, muted text, and surfaces all
lean the same direction as the accent. Text-to-muted contrast is pushed
higher than the other themes so scanning a dense table doesn't require
close reading — the important number should be findable at a glance.

## Density

The tightest spacing and radii of the three themes: `--space-6` is 24px
(vs. a roomier default elsewhere), `--radius-lg/md/sm` are 10/7/5px.
Corners read as "cut," not "rounded." Shadows are short and close to the
surface (`--shadow-card` / `--shadow-pop`) rather than soft and floating —
depth should feel structural, not decorative.

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
