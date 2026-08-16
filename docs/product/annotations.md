# Docs annotation overlay

A **temporary dev-only instrumentation layer** that projects our own product docs onto the
running app: a per-route panel plus numbered badges pinned to real components, each expandable
into purpose / affordances / actions / feedback. It exists to make `docs/product/screens.md`
checkable against the live app in seconds instead of by re-reading both side by side, and to give
a new contributor (or an agent) a fast "what is this thing and why does it exist" for any surface
without leaving the page. It is not a feature; it ships behind a dev-only flag and is designed to
be deleted in one pass once it's stopped earning its keep (see "Retiring the layer" below).

**Toggle it**: the sidebar nav item labeled "Docs overlay" (between Settings and the collapse
toggle, desktop only), the mobile avatar-menu sheet's "Docs overlay" row, or `Shift+D` anywhere in
the app. All three dispatch the same `toggle-docs-overlay` `window` `CustomEvent` — the decoupled
event idiom the sidebar already uses for `open-add-course` — which the overlay root
(`src/components/docs-overlay/DocsOverlay.svelte`) listens for and folds into
`src/lib/docs-overlay/store.ts`'s `overlayOpen` atom (persisted to `localStorage['sb:docs-overlay']`
so a reload keeps it open mid-review).

## How it stays out of production

Two different gates, because one wasn't enough:

- **The toggle buttons** are guarded inline on `import.meta.env.PUBLIC_DOCS_OVERLAY === 'true'`
  (set only in `.env.development`, which Vite loads for `astro dev` and never for `astro build`).
  This part works as expected — the guard folds to `false` at build time and the markup vanishes.
- **The overlay itself** is injected by `docsOverlayIntegration()` in `astro.config.mjs`
  (`src/lib/docs-overlay/integration.mjs`), which injects `src/lib/docs-overlay/mount.ts` **only
  when Astro's `command` is `dev`**.

That second gate exists because the obvious approach failed a real check. The overlay was
originally a `{FLAG && <DocsOverlay client:idle />}` island in `AppShell.astro`. The guard folded
correctly server-side — nothing rendered — **but Astro registers `client:*` islands at
build-analysis time, not by runtime reachability, so the island chunk was emitted anyway**: a
measured 55.5 KB of internal annotation prose sitting in `dist/client/_astro/` as a publicly
fetchable asset. Gating on `command` instead means a production build never pulls the overlay into
the module graph at all, so nothing is emitted. Verify with `npm run build && grep -rl 'hallway
job' dist/` — zero hits is the pass condition.

Escape hatch: `PUBLIC_DOCS_OVERLAY=true npm run build` (a real shell export — `.env` files don't
trigger it) forces the overlay into a build for a preview smoke test, and logs a loud warning.
`PUBLIC_DOCS_OVERLAY=false` turns it off in dev.

**Dev-loop gotcha, observed in practice:** a long-running `astro dev` daemon can silently stop
emitting the injected `astro:scripts/page.js` after later edits — the overlay then renders nothing
at all, on every route, with no console error and no server error, which looks exactly like a code
defect. Confirm by curling an authenticated page and grepping for `astro:scripts/page.js`; if only
`before-hydration.js` is present, the injection was dropped. The fix is the same recovery the repo
already documents for the Vite cache: `astro dev stop`, then
`rm -rf node_modules/.vite node_modules/.astro .astro`, then `astro dev --force`. Do this before
concluding the overlay is broken, and note that grepping the HTML for `mount.ts` is **not** a valid
check — the injected script is a bundled virtual module and never mentions the source filename.

## The binding rule

`src/lib/docs-overlay/annotations.ts` — `ROUTE_ANNOTATIONS: RouteAnnotation[]` plus
`SHELL_ANNOTATIONS: Annotation[]`, typed in `src/lib/docs-overlay/types.ts` — is **the
machine-readable projection of this doc's sibling, `docs/product/screens.md`**. It is not a
separate source of truth; every `RouteAnnotation` restates a `screens.md` route row as data, and
every `Annotation` restates one of that row's Key Components as a structured card.

The rule this implies, non-negotiably: **changing a route's purpose or a component's behavior
updates `screens.md` and `annotations.ts` in the same commit.** A route rename, a component that
gets renamed or deleted, a purpose that shifts (e.g. the v1.8 course-home rebuild that retired
`StandingTab`/`TasksCard`/`DeadlinesCard`) — all of these are doc changes first, and the overlay
registry is part of that doc change, not a follow-up. `npm run check:annotations` (below) is the
mechanical enforcement of this rule; treat a failing run the same as a failing type-check, not as
optional tidying.

## Field vocabulary

Every `Annotation` has four content fields beyond `name`/`selector`. Keep them in their lane —
overlapping fields is the single most common way this doc drifts into "restates the code" instead
of "explains the product":

| Field | What belongs here |
|---|---|
| `purpose` | The job this component exists to do, one sentence, in the user's terms ("checkable hero for what's due" not "renders a `<TodayTasks>` island"). |
| `affordances` | What the student can **perceive** they can do — visible buttons, chips, hover reveals, drag handles. If it's not discoverable by looking, it's not an affordance. |
| `actions` | What actually **happens** on interaction — the endpoint hit, the store mutated, the route navigated to. This is the only field that should name code (`PATCH /tasks/:id`, `completionMotion`, `sb:weekview`). |
| `feedback` | How the app **responds** — optimistic flips, motion (the completion hold/depart choreography), error toasts, empty states. This is the field most existing docs skip; it's the whole reason this overlay exists rather than just linking `screens.md` from a `?` icon. |

`docs: string[]` on both `Annotation` and `RouteAnnotation` is provenance — the doc path(s) an
entry was distilled from (usually `docs/product/screens.md`, sometimes a design doc like
`docs/design/mobile-shell.md` for a mobile-only affordance). It's how the panel links back to
prose instead of just repeating it.

## In-scope routes (deliberately partial)

`/dashboard`, `/planner`, `/tasks`, `/courses/[slug]`, `/learn/[kcId]`, `/settings`, plus the shell
(`Sidebar`, `Header`, `HeaderActions`, `BottomNav`). This is the set of "hallway job" surfaces —
the ones a returning student actually lives in day to day per `docs/product/student-lifecycle.md`
— not the full ~25-route inventory in `screens.md`. Annotating every kept-alive-but-unlinked route
(`/study`, `/grades`, `/notes`, …) for a layer whose whole premise is "temporary instrumentation"
isn't worth the doc-sync commits it would demand; coverage grows only if a route becomes worth
walking a new contributor through. `scripts/annotations-check.cjs`'s `CONFIG.inScopeRoutes` is the
literal source of truth for this list — extend it there when a route earns coverage, not just in
prose here.

Partial coverage *within* an in-scope route is also expected and fine: a component listed in
`screens.md`'s Key Components column doesn't strictly need an `Annotation` the day it lands. Add it
to the check script's `KNOWN_UNANNOTATED` allowlist with a one-line reason instead of leaving the
check red or writing a rushed entry.

## Anchoring

Each `Annotation.selector` is a CSS selector resolved against the live document at runtime — there
is no build-time binding between a badge and a component, so nothing catches a mismatch except
`npm run check:annotations`'s live half (or a human noticing a badge floating over nothing).

**Prefer the load-bearing `.slot-*` wrapper over the component's own root markup.** Most cards in
this app render a bare `<section class="card">` as their outermost element (`CourseHome.svelte`,
`CourseTasks.svelte`, `UpNextCard.svelte`, `AssessmentsCard.svelte`, and most of
`src/components/dashboard/` and `src/components/course/` follow this pattern) — `.card` alone
can't distinguish one from another on a page with a dozen cards. The pages that host these
components already wrap each one in a purpose-named `.slot-*` div for their own CSS ordering
(`dashboard.astro`'s `.slot-week` / `.slot-today` / `.slot-courses` / `.slot-record` /
`.slot-deadlines`; `CourseHome.svelte`'s `.slot-tasks` / `.slot-understand` / `.slot-attendance` /
`.slot-upnext` / `.slot-standing` / `.slot-assessments` / `.slot-mastery` / `.slot-practice` /
`.slot-activity` / `.slot-about`) — anchor to those instead. They're unique, they're already
load-bearing (removing one breaks the page's own layout, so they're not going anywhere), and they
resolve to exactly the card you mean regardless of what the component renders internally.

**Known failure mode**: renaming or removing a `.slot-*` class (or any selector an `Annotation`
depends on) silently orphans its badge — the overlay just won't render one, with no console error,
no build failure, nothing. This is exactly the failure `scripts/annotations-check.cjs`'s live half
exists to catch: it visits every annotated route and asserts every selector resolves to at least
one node, failing loudly (`route → component → selector`) instead of leaving a badge quietly
missing. Run it after any refactor that touches class names on an annotated page.

**Not every annotated selector is expected to resolve on a plain page load, though.** Several
planner and learn surfaces are genuinely view- or interaction-mounted, not always-present: `/planner`'s
`CalendarGrid`/`AgendaList` only exist once the view switcher leaves the default Week view,
`EventPopover`/`CreateSessionPopover` only exist after clicking an item or an empty slot, and
`/learn/[kcId]`'s `ScaffoldChat` only mounts once `AbsorbFlow` reaches Stage 4. That's a property of
the app, not a doc gap — the check script's `CONFIG.EXPECTED_UNRESOLVED` allowlist names exactly
these cases (plus `VerifyQuiz`/`InterestRanker`, Stages 2/3 of the same flow) and reports them as
their own "expected-unresolved" line every run rather than silently skipping or falsely passing
them, so a selector that starts resolving unexpectedly (or a genuinely broken one hiding on this
allowlist) still surfaces. One gotcha if you're hand-verifying one of these selectors yourself:
a raw `grep` for the class name will often return a match even when the element never rendered,
because Svelte inlines the component's own `<style>` block into the page's HTML text — scope the
grep to the `class="..."` attribute (or just trust the live check, which asserts against the
resolved DOM via Playwright, not page text).

## Adding a route

1. Add or update the row in `screens.md`'s route table (or, for a shell surface, the "Shell
   components" bullet list).
2. Add a matching `RouteAnnotation` (or `Annotation` to `SHELL_ANNOTATIONS`) in
   `src/lib/docs-overlay/annotations.ts`, filling in `purpose`/`affordances`/`actions`/`feedback`
   per the vocabulary above and a `docs` provenance entry.
3. Add the route to `CONFIG.inScopeRoutes` in `scripts/annotations-check.cjs` if it's new (already
   present for the six routes above).
4. Run `npm run check:annotations` — both the static half (route/component coverage) and, if
   `astro dev` is up, the live half (selectors actually resolve).
5. Land the doc + registry changes in the same commit, per the binding rule.

## Retiring the layer

This whole thing is meant to come out cleanly once it's stopped paying for itself. To remove it
entirely:

- Delete `src/lib/docs-overlay/` and `src/components/docs-overlay/`.
- Delete this doc (`docs/product/annotations.md`) and `scripts/annotations-check.cjs`.
- Remove the `docsOverlayIntegration` import and its `integrations:` array entry from
  `astro.config.mjs`.
- Revert the flag-guarded wiring: the nav-item button in `src/components/shell/Sidebar.astro`
  (markup + its `docs-overlay-btn` script block), the sheet row in
  `src/components/shell/AvatarMenu.svelte`, and the explanatory comment left where the mount used
  to live in `src/layouts/AppShell.astro`.
- Remove the `PUBLIC_DOCS_OVERLAY=true` line from `.env.development` (and the `.env.local` /
  `.env.*.local` lines added to `.gitignore`, if nothing else needs them).
- Remove `--z-docs-overlay` from `src/styles/tokens.css`.
- Remove the `check:annotations` script from `package.json`.
- Remove the `annotations.md` entry and reading-guide line from `docs/README.md`, and the header
  note atop `screens.md`.

Nothing outside those files should reference the layer — if `grep -r docs-overlay src/` or
`grep -r PUBLIC_DOCS_OVERLAY .` turns up anything after the above, the retirement is incomplete.

## TODO

- Whether the panel should support exporting the currently-annotated route as a standalone
  Markdown snippet (for pasting into a PR description) — deferred until someone actually wants it.
- Badges are real `<button>` elements, so they're already Tab-reachable and activatable by
  keyboard; what's missing is arrow-key cycling *between* badges and a shortcut to jump from a
  panel row to its badge.
- Whether `KNOWN_UNANNOTATED` entries should have an expiry or review date so they don't quietly
  become permanent — not enforced yet, just a convention.
