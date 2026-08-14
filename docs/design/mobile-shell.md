# Mobile Shell Conventions

Architecture reference for the mobile layout system landed in the M0 foundation track (see
`/Users/sdawka/.claude/plans/we-want-to-have-cheeky-fog.md` for the full plan this implements).
Anything a later track touches that isn't in this file — bespoke per-page mobile compositions,
the Sheet primitive's actual behavior, PWA head tags — is covered in that plan or will get its
own doc; this file is only the shell-level contract everything else builds on.

## Breakpoint

Mobile shell cutover: **`@media (max-width: 767px)`**. The desktop layout-check matrix (≥820px)
is untouched; 768–1023px still gets the desktop shell (sidebar + header cluster), it's just
narrower.

The canonical breakpoint string is `MOBILE_QUERY` in `src/lib/stores/viewport.ts`:

```ts
export const MOBILE_QUERY = '(max-width: 767px)';
export const isMobile = atom<boolean>(/* matchMedia-backed, SSR-safe */);
```

CSS can't reference a JS constant, so every mobile `@media` rule in the app duplicates the
literal `767px` by necessity — that's expected, not drift. JS consumers (popover→sheet islands,
PlannerView's Agenda default, etc.) should read the `isMobile` nanostore instead of re-deriving
their own `matchMedia` call, so there's exactly one source of truth on the JS side. The route-page
Escape guards in `planner.astro`/`tasks.astro` are a deliberate, documented exception: they're
plain hoisted `<script>` tags outside any Svelte/store consumer path, so they inline the literal
directly rather than importing a nanostores module into a non-hydrated script.

There is no `html[data-mobile]` attribute. SSR can't know the viewport, and the only JS consumers
that need to know (popover islands) render nothing until opened, so there's no hydration
mismatch to guard against.

## Three query mechanisms — when to use which

1. **`@container` (queried against `main`)** — page-content layout. This is the pre-existing
   convention (dashboard rail at 936px, StandingTab at 836px, WeekView's day strip at 616px,
   resources tile grid at 600px, feed masonry at 476px) and mobile work doesn't change it: pages
   keep reflowing based on the actual content-box width they're given, not the viewport, so the
   same rules fire correctly in both sidebar states on desktop *and* at the mobile breakpoint.
   Comment these thresholds as **"main content-box ≤ Xpx"** — the number is padding-independent
   (measured on `main`'s content-box, after its own padding is subtracted), so it stays accurate
   if `--content-pad-x` ever changes.
2. **`@media (max-width: 767px)`** — shell chrome and viewport-fixed overlays only: the bottom
   tab bar, sheets, the route-layer mobile restyle (planner/tasks becoming full pages instead of
   centered modals). This tier never reflows a page's *internal* grids — those stay on
   `@container` thresholds specifically so they're independent of chrome (sidebar collapsed,
   pad tokens changing, etc.).
3. **`@media (hover: none)` / `(pointer: fine)`** — touch-affordance changes only (e.g. suppress
   a hover-only affordance like WeekGrid's hover card on a touch device), never layout. A layout
   change gated on a hover query would fire on trackpad users, external-keyboard tablet users,
   etc. — layout should key off the viewport-width tiers above.

## Token inventory

Structural tokens live in `tokens.css` `:root` and are theme-agnostic (mobile overrides below are
shared/structural, never per-theme — see `docs/design/charter.md`'s theme rule: identical layout
across all 3 themes at any viewport).

| Token | Desktop | Mobile (≤767px) |
|---|---|---|
| `--content-pad-x` | `32px` | `16px` |
| `--content-pad-top` | `28px` | `16px` |
| `--content-pad-bottom` | `56px` | `calc(24px + var(--tabbar-h) + env(safe-area-inset-bottom))` |
| `--header-h` | `56px` | `56px` |
| `--tabbar-h` | `56px` | `56px` (irrelevant above the breakpoint — bottom nav is `display:none`) |
| `--z-tabbar` | `210` | `210` |
| `--z-sheet` | `240` | `240` |

`AppShell.astro`'s `main` padding uses `--content-pad-top`/`-x`/`-bottom` instead of literal
values; the desktop values are byte-identical to what they replaced, so `check:layout`'s
`mainInlinePaddingPx` reads and every existing `@container` threshold stay true with zero drift.

## Z-index inventory

Documentation of what's already in the codebase, **not** a live migration — only the two new
mobile-shell layers (tab bar, sheet) got dedicated tokens. Everything else below is an existing
raw value, listed here so a new layer can be slotted in without colliding:

```
grid 1-3        dashboard rail internals (WeekView day/now-indicator, etc.)
header 30       sticky app header (Header.astro)
popover 50      header popovers (.popover recipe — base.css)
hover-card 60   WeekGrid's hover-only preview card
event-pop 70    EventPopover, CreateSessionPopover
modal 100       LogEventModal (already portals to <body>)
route-layer 200 planner.astro / tasks.astro fixed layer — desktop
route-layer 10  same layer at ≤767px (drops below header/tabbar; see below)
tabbar 210      BottomNav — --z-tabbar
sheet 240       Sheet.svelte (S2) — --z-sheet, above everything else
```

## The containing-block fix (and why the overlay slot exists)

`main` has `container-type: inline-size` (for the `@container` sites above). That property
implies `contain: layout`, which makes `main` the **containing block** — and stacking context —
for every `position: fixed` descendant. Before this track, the planner/tasks route layers (and
everything inside them: `PlannerView` → `EventPopover`, `CreateSessionPopover`, WeekGrid's
hover-card) were rendered inside `main`'s default slot, so their "fixed" positioning actually
resolved against `main`'s box, not the viewport — the scrim missed the sidebar, the sticky header
painted over the layer instead of under it, and popovers computed viewport-coordinate math against
the wrong box and rendered offset from the element that opened them.

The fix: `AppShell.astro` has a second slot, `<slot name="overlay" />`, mounted as a **direct
`<body>` child** after `.shell` (siblings, not nested):

```astro
<div class="shell">…</div>
<BottomNav />
<slot name="overlay" />
```

`planner.astro` and `tasks.astro` pass their `.planner-layer` / `.tasks-layer` divs with
`slot="overlay"` — an attribute-only change; scoped styles and hoisted `<script>` tags keep
working exactly as before. Once rendered at the body level, their fixed descendants resolve
against the viewport again: scrims cover the whole page (including the sidebar), the layer's
`z-index: 200` legitimately beats the header's `z-index: 30` in the *root* stacking context, and
EventPopover/CreateSessionPopover/the hover-card's existing viewport-coordinate math becomes
correct with zero code changes on their side.

`AddCourseModal` was already a `.shell` child (not inside `main`), so it was never trapped.
`LogEventModal` already portals itself to `<body>` via the `portalToBody` Svelte action (now
extracted to `src/lib/actions/portal.ts` so `Sheet.svelte` can reuse it — a portaled sheet
triggered from the header sits inside the header's own `backdrop-filter` containing block and
needs the same escape hatch).

A `.content`-wrapper alternative was considered and rejected: giving `main`'s wrapper
`container-type` instead would still `contain: layout` and trap fixed descendants identically —
the overlay slot is the only fix that doesn't also require touching every fixed-position
consumer's code.

## Bottom nav

`src/components/shell/BottomNav.astro`, mounted in `AppShell`'s `<body>` after `.shell`.
`display: none` above the breakpoint; at ≤767px: fixed to the bottom, `grid-template-columns:
repeat(5, 1fr)`, `min-height: var(--tabbar-h)`, `padding-bottom: env(safe-area-inset-bottom)`,
`z-index: var(--z-tabbar)`. Five slots: **Home · Tasks · [Record FAB] · Planner · Courses**.
Active state is computed server-side from `Astro.url.pathname` (same pattern as
`Sidebar.astro`'s `isActive`); Courses is active for any `/courses*` path, not just the index.

The center **FAB** (48px circle, `var(--accent)`, raised `-10px`, `var(--shadow-pop)`) dispatches
a `window` `CustomEvent('open-record-event')` on click. **Nothing listens to this event yet** —
`HeaderActions.svelte` adds the listener in the S1 track (wiring it to `LogEventModal`'s existing
`bind:open`, alongside the pre-existing `e` keyboard shortcut). The FAB dispatching into the void
is expected for this phase, not a bug.

Feed, Settings, Scratchpad, past-terms, and Add-course don't get their own tab — they move to the
avatar sheet (S2) or live on `/courses` (Add-course via the existing `open-add-course` window
event `Sidebar.astro` already dispatches).

`Icon.astro`'s glyph set (house, plus, gear, bell, check-square, calendar, x, chevron-left,
chevron-down, pencil, user) has no "courses/book" glyph and `Icon.astro` isn't owned by this
track, so the Courses tab inlines its own `<svg>` stroke path rather than adding a name there.

## Route modals → tab destinations (mobile, CSS-only)

At ≤767px, `planner.astro`/`tasks.astro`'s fixed layer stops being a centered modal-with-scrim and
becomes a full page between the header and tab bar — a tab destination, not an overlay:

```css
@media (max-width: 767px) {
  .planner-layer { top: calc(var(--header-h) + env(safe-area-inset-top));
                   bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom)); z-index: 10; }
  .scrim { display: none; }
  .panel { margin: 0; border-radius: 0; box-shadow: none; padding: 16px 16px 24px;
           overscroll-behavior: contain; }
  .close-btn { display: none; }
}
```

The header (z-30) and tab bar (z-210) stay visible and tappable around it; `.panel-head h1`
effectively becomes the page title; "back" is normal history navigation via tapping another tab
(the existing `history.back()` / `location.assign('/dashboard')` fallback in `closePlanner`/
`closeTasks` is unused at this breakpoint since nothing calls it — no scrim, no close button — but
is left in place since it's still live above 767px). Desktop CSS above the media query is
byte-identical to pre-M0.

Both pages' `keydown` Escape handlers are guarded: `if (matchMedia('(max-width: 767px)').matches)
return;` before the existing `__plannerBlockEscape`/`__tasksBlockEscape` check, since there's no
scrim to dismiss at this breakpoint.

## Sheet contract (stub — S2 defines the primitive)

`Sheet.svelte` doesn't exist yet; this is the frozen surface later tracks build against so nobody
has to coordinate a rename later.

- **Class names**: `.sheet-layer` (fixed, `inset: 0`, `z-index: var(--z-sheet)`, portaled to
  `<body>` via `portalToBody`) contains `.sheet-scrim` (reuses the route-modal scrim recipe) and
  `.sheet-panel` (bottom-anchored, `max-height: 85dvh`, top-only `var(--radius-lg)`,
  `var(--shadow-pop)`, safe-area bottom padding, grab-handle visual). `.sheet-panel` contains
  `.sheet-body` (`overflow-y: auto; overscroll-behavior: contain`) for the scrollable content.
- **Escape protocol**: a sheet joins the same convention as the route layers — while open, it
  sets a window-level "block escape" flag so a nested popover/form can consume the first Escape
  before the sheet itself closes (mirrors `__plannerBlockEscape`/`__tasksBlockEscape`).
- **Dismissal**: scrim tap, explicit close button, or Escape (subject to the block-escape
  protocol above). No drag-to-dismiss in this pass.
- **`bindPopoverDismiss` gotcha** (documented here so S2 doesn't have to rediscover it): the
  existing outside-pointerdown dismissal in `popover.svelte.ts` must be gated on
  `!isMobile.get()` — a portaled sheet is *always* "outside" the trigger button from that
  listener's point of view, so without the gate a sheet would immediately dismiss itself on open.

## PWA head tags

Owned by the S3 track (`public/**`, `scripts/gen-icons.mjs`, `login.astro`, `ThemeScript.astro`,
and `AppShell`'s `<head>`) — intentionally not touched here. M0 only guarantees `AppShell`'s
`<body>` structure (`.shell` → `BottomNav` → `<slot name="overlay" />`) is stable for S3 to add
head-only markup on top of.
