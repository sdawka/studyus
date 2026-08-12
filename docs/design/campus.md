# Campus theme

**Voice (binding, per the theme charter).** Campus should feel like sitting
down at a worn library table with your own notebook — not like opening
software. Warmth comes from three sources: paper (cream/oatmeal, never
gray-beige), ink (warm brown-black, never pure black), and type (Fraunces'
soft curves doing real work on titles and hero numbers, not decoration
confined to page `<h1>`s). "Historical/collegiate" means the vocabulary of a
lecture hall and reading room — running heads, brick-binding red — with zero
heraldry or faux-antique kitsch. Softness stops at the data boundary: grades,
percentages, and dates stay high-contrast and instantly scannable; warmth is
delivered through frame, color, and voice around the numbers, never by
softening the numbers themselves. Separation is shadow-led (warm, raised),
never hairline-led — that's compass's device, not campus's.

## Type

- **Display:** Fraunces Variable, falling back to Georgia / Times New Roman.
  Fraunces is a real serif with soft, slightly wonky curves — headings finally
  read as *collegiate* rather than corporate. Lean into its weight range for
  hierarchy: light-ish for large numerals, heavier for section titles.
- **Hero numbers and card titles are now also Fraunces**, via the shared
  `--font-num` and `--font-title` hooks (`.num`/`.figure` and `.card-title`
  in `base.css`). This was the single most load-bearing fix from the theme
  debate: grades and course titles finally carry the serif, not just page
  `<h1>`s.
- **Kickers (`--font-kicker`) are set to Fraunces Variable, and now actually
  tilt italic.** `.kicker` in `base.css` reads `font-style: var(--kicker-style,
  normal)`; campus sets `--kicker-style: italic`, so running heads land as a
  genuine Fraunces italic — the collegiate running-head treatment the theme
  debate asked for, not just the upright family.
- **Body:** Nunito Variable, a rounded, warm-tempered sans that keeps long
  reading comfortable and echoes the softness of the display face without
  competing with it.
- Base size is 15.5px — a hair larger than the other themes, matching the
  more relaxed, book-page density. Hero figures (`--text-figure`) render at
  34px, the largest of the three themes.
- Caps tracking is slightly wider (`0.09em`) so all-caps labels read like
  running heads rather than UI chrome.

## Color story

Warm paper, not clinical white — and now genuinely layered, not flat.
`--bg` sits at `oklch(95% 0.022 80)` (the oatmeal desk) under `--surface` at
`oklch(97.5% 0.02 82)` (the lighter paper on top) — separated enough to read
as two surfaces, not one dingy off-white. Ink is warm (never pure-black), and
borders are warm-hued throughout. The accent is a brick/rust tone — the color
of a worn library binding, not a startup blue. Status colors (good/warn/
danger) are all warmed a few degrees so nothing reads as a cold, generic
traffic light: sage green, mustard ochre, and a brick-adjacent crimson that
stays clearly distinct from the accent hue.

Dark scheme is genuinely warm dark — brown-black surfaces with a candle-lit
glow, not the same cool charcoal as the other themes. `--accent-soft` and
`--surface-2` in dark carry extra chroma (`0.07`/`0.038` respectively) so
hovers and soft accent fills read as glowing embers, not just darker gray.
Every OKLCH hue in the dark blocks stays in the same warm family as light
mode; only lightness and chroma shift. The two dark blocks (the
`prefers-color-scheme` media query and the explicit `[data-scheme='dark']`
selector) must stay byte-identical — verify after any dark-mode edit.

## Shadows and structure

Cards separate from the page by warmth and elevation, not by lines.
`--shadow-card` is `0 3px 6px rgba(90,50,20,.10), 0 14px 30px -8px
rgba(90,50,20,.16)` — a visible, brown-tinted double shadow meant to be felt
as "resting on a desk," not a subtle 1px hint. `--shadow-pop` is stronger
still for popovers/modals. `--hairline` recedes further from `--border`
(`oklch(93% 0.024 76)`) so it never competes with shadow as the primary
separation device — hairline-led structure is compass's identity, not
campus's, and the charter vetoes campus drifting toward it.

## Course color

The single course-color carrier (top strip / highlighter-tab wash) runs at
near-full chroma — `--course-c: 0.12`, `--course-ink-c: 0.1` — the strongest
of the three themes. Campus only gets one placement for its course mark per
the shared cardinality rule, so it has to land with real color; there's no
shared chroma clamp forcing it toward compass's or focus's calmer values.

## Density & motion

Campus is the most relaxed of the three themes: generous spacing
(`--space-6` at 34px), the softest and largest corner radii (22/16/11px),
and diffuse, warm-tinted shadows instead of crisp cool ones. Motion is the
gentlest of the set — `--motion-base` at 220ms with a soft ease-out curve
(`cubic-bezier(0.16, 1, 0.3, 1)`), so panels and popovers settle rather than
snap.

## Now-line and nav tick

Campus does not override `--now-line-color`, `--now-line-glow`, or
`--nav-active-tick` — it relies on the shared defaults (`--danger`, `none`,
`0`), which is a deliberate charter ruling to preserve campus's current,
already-correct behavior with zero visual regression. Only focus opts into
the accent-glow now-line and a nonzero nav tick.

## Do

- Let Fraunces carry headings, card titles, *and* hero numbers — not just
  page headings. This was the most load-bearing charter fix for campus.
- Keep separation shadow-led; keep warmth consistent across light and dark —
  no cool grays sneaking in.
- Use the generous spacing scale; don't tighten campus layouts to match the
  denser themes.

## Don't

- Don't introduce new component selectors or markup — campus only changes
  token values (fonts, colors, spacing, motion), same as the other themes.
- Don't let the accent (brick/rust) collide with the danger status color —
  they're deliberately different hues; don't nudge them closer.
- Don't flatten the dark scheme's warmth into a generic cool dark mode.
- Don't let hairlines become the primary structural device — shadow leads,
  per the charter veto.
