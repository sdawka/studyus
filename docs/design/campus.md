# Campus theme

**Voice.** Warm paper, collegiate, bookish. Think a well-loved lecture hall
notebook and a used-bookstore reading room — not a productivity dashboard.
Campus should feel unhurried, tactile, and a little literary next to the
other two themes.

## Type

- **Display:** Fraunces Variable, falling back to Georgia / Times New Roman.
  Fraunces is a real serif with soft, slightly wonky curves — headings finally
  read as *collegiate* rather than corporate. Lean into its weight range for
  hierarchy: light-ish for large numerals, heavier for section titles.
- **Body:** Nunito Variable, a rounded, warm-tempered sans that keeps long
  reading comfortable and echoes the softness of the display face without
  competing with it.
- Base size is 15.5px — a hair larger than the other themes, matching the
  more relaxed, book-page density.
- Caps tracking is slightly wider (`0.09em`) so all-caps labels read like
  running heads rather than UI chrome.

## Color story

Warm paper, not clinical white: cream/oatmeal backgrounds, a warm (never
pure-black) ink, and warm-hued borders throughout. The accent is a
brick/rust tone — the color of a worn library binding, not a startup blue.
Status colors (good/warn/danger) are all warmed a few degrees so nothing
reads as a cold, generic traffic light: sage green, mustard ochre, and a
brick-adjacent crimson that stays clearly distinct from the accent hue.

Dark scheme is genuinely warm dark — brown-black surfaces with a
candle-lit glow, not the same cool charcoal as the other themes. Every OKLCH
hue in the dark blocks stays in the same warm family as light mode; only
lightness and chroma shift.

## Density & motion

Campus is the most relaxed of the three themes: generous spacing
(`--space-6` at 34px), the softest and largest corner radii (22/16/11px),
and diffuse, warm-tinted shadows instead of crisp cool ones. Motion is the
gentlest of the set — `--motion-base` at 220ms with a soft ease-out curve
(`cubic-bezier(0.16, 1, 0.3, 1)`), so panels and popovers settle rather than
snap.

## Do

- Let Fraunces carry headings and big numbers; keep body copy in Nunito.
- Keep warmth consistent across light and dark — no cool grays sneaking in.
- Use the generous spacing scale; don't tighten campus layouts to match the
  denser themes.

## Don't

- Don't introduce new component selectors or markup — campus only changes
  token values (fonts, colors, spacing, motion), same as the other themes.
- Don't let the accent (brick/rust) collide with the danger status color —
  they're deliberately different hues; don't nudge them closer.
- Don't flatten the dark scheme's warmth into a generic cool dark mode.
