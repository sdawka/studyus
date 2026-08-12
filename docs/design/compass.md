# Compass — design language

Compass is the default theme. Voice: **airy, light, precise.** It should feel like a
well-run studio — plenty of breathing room, one confident accent color, flat surfaces
that separate by border and background step rather than shadow, and information
presented with quiet precision (tabular numbers, small caps labels, calm motion).

## Type

- **Display** (`--font-display`): Figtree Variable, falling back to Avenir Next / Söhne
  / system-ui. Used for h1/h2 and anything that needs a distinct voice from body copy.
  Figtree is geometric-humanist — round, friendly, but precise — deliberately *not*
  macOS system SF, so headings read as "product" rather than "OS chrome."
- **Body** (`--font-body`): stays on the system stack (SF Pro Text / system-ui). Body
  copy should feel native and fast, not decorative — the personality lives in display
  type, color, and spacing, not in body letterforms.
- **Mono** (`--font-mono`): system mono stack, used for course codes, timestamps, and
  tabular data.
- Base size 15px. Weight scale is restrained: 510 (medium), 550 (semibold), 650 (bold)
  — never true 700/800; Compass should never look shouty.

## Color

- One product accent (teal, hue ~170) carries primary actions, active nav state, and
  progress. Do not introduce a second "brand" hue.
- `--good` (success/positive) is tuned into the same family as the accent (hue ~163,
  a touch cooler) rather than a separate leafy green — the prototype's ok-pills used the
  accent-soft/accent-ink pair, and Compass should keep looking like it has one coherent
  positive-signal color, not two competing greens. `--warn`/`--danger` stay distinct
  (amber, red) since those are genuinely different signals.
- Light neutrals are cool, barely-tinted grays (hue 240, near-zero chroma) — the goal is
  "paper," not "gray box."
- Dark neutrals keep the same hue family, inverted. Because cards carry no shadow, the
  dark ramp separates `--surface`/`--surface-2` from `--bg` by a full step (~7 L) so
  cards still read as distinct panels purely from background contrast + a visible
  hairline border.

## Elevation

- **`--shadow-card: none`.** Compass cards are flat — border + background step only,
  never a shadow. This is the single most identifying trait of the theme; if a card
  anywhere in Compass has a shadow, that's a bug.
- `--shadow-pop` is the one exception: popovers, menus, and modals — transient surfaces
  that sit *above* the page — keep a soft shadow so they read as floating.

## Spacing & density

- Generous, airy spacing. `--space-6: 32px` (vs. a tighter theme's ~24px), with the
  rest of the scale (`--space-1..5`: 4/8/13/18/24px) stepped proportionally rather than
  on a strict power-of-two grid — spacing should feel considered, not mechanical.
- Radius stays soft-rounded but not pill-happy for cards: `--radius-lg: 14px`,
  `--radius-md: 9px`, `--radius-sm: 6px`.

## Motion

- Calm, not snappy. `--motion-fast: 130ms`, `--motion-base: 200ms`,
  `--ease: cubic-bezier(0.22, 1, 0.36, 1)` — an ease-out curve that settles gently
  rather than overshooting or feeling clicky.

## Do / don't for future components

- **Do** express hierarchy with a background/border step and generous padding.
- **Do** keep the accent to one hue family across accent + good; if you need a new
  positive-signal color, tune it near `--accent`, don't invent a new green.
- **Don't** add `box-shadow` to any card, panel, or list row — that's Focus/Campus
  territory, not Compass. Reach for `--shadow-pop` only on floating UI.
- **Don't** introduce a second display typeface or drop to system font for headings —
  the Figtree/system split (display vs. body) is what keeps Compass feeling designed
  without being loud.
- **Don't** tighten spacing to fit more on screen — if content is cramped, that's a
  layout problem to solve elsewhere, not a reason to shrink `--space-*` tokens here.
