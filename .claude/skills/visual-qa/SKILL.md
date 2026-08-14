---
name: visual-qa
description: Screenshot the running app across all themes/schemes/pages and fan out Haiku reviewer agents to find visual defects, then fix and re-verify. Use after any UI change, theme work, or when asked to "check the app visually".
---

# Visual QA

Screenshot the app with Playwright, review with parallel Haiku agents, fix findings, re-shoot to confirm.

## 1. Prerequisites

- Dev server running: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && npx astro dev --port 4350` (background, any free port — pass it to the script).
- Playwright is installed globally under node v20 with cached Chromium. Invoke via:
  ```bash
  N20=~/.nvm/versions/node/v20.20.2
  NODE_PATH=$N20/lib/node_modules $N20/bin/node scripts/visual-qa.mjs http://localhost:4350 <outDir>
  ```
- Credentials: seeded user `student@example.com` / `studyus` (override with `VQA_EMAIL`/`VQA_PASSWORD` — the pre-rename `studybuddy` hash died with the 2026-08-13 DB wipe + reseed, see `.claude/skills/agent-wave/SKILL.md`).
- Output dir: use the session scratchpad, not the repo.

## 2. Capture — `scripts/visual-qa.mjs`

The harness logs in via the API and captures (~60 shots):
- **Theme matrix**: dashboard, course overview, planner, settings × {compass, focus, campus} × {light, dark} — theme/scheme set via `PATCH /api/v1/user {settings:{theme,scheme}}`.
- **Single-pass (compass/light)**: courses index, all six course tabs, feed, tasks, notes, profile, login (unauthenticated).
- **Interaction states**: each header popover (bell `button[title="Notifications"]`, todo `button[title="To-do"]`, scratchpad `button[title="Scratchpad"]`, avatar `button.avatar`), Record-event modal, Add-course modal, collapsed sidebar (`data-sidebar="collapsed"`), narrow 820px viewport.
- **Mobile pass (390×844)**: every matrix + single-pass page reshot at the mobile-shell breakpoint (`docs/design/mobile-shell.md`'s `≤767px`), compass/light, plus the two header sheets that only exist there — bell and avatar (`mobile-390--dashboard-bell-sheet`/`-avatar-sheet`). Todo/scratchpad have no bottom-nav tab of their own and aren't shot standalone — they're covered by the avatar sheet's mobile-only rows. If the mobile-shell breakpoint or viewport width in `layout-check.cjs`'s `CONFIG.mobileViewportWidths` ever changes, update both scripts together — this harness's 390 tracks the narrower of that pair.
- It also collects JS console/page errors — treat any as a finding.
- **Gotchas**:
  - A corrupted Vite deps cache (404 on `@astrojs_svelte_client` → no island hydrates, clicks do nothing; or SSR 500s citing missing `deps_ssr/` files) means a full cold-cache recovery, not just a plain restart: `astro dev stop`, then clear **all three** caches — `rm -rf node_modules/.vite node_modules/.astro .astro` (the project-local `.astro/` content-layer cache, not just the shared Vite deps cache) — then `astro dev --force` (background) and curl a couple of pages (e.g. `/login`, `/dashboard`) to force Vite to re-optimize dependencies and warm the route cache *before* pointing Playwright at it; a Playwright run against a still-cold server reads as the same island-not-hydrating symptom and gets misdiagnosed as a real bug. **Root cause**: running `npm run build` — or `astro check` / `npm run check` — while a dev server is live corrupts the shared `node_modules/.vite` cache; never run either mid-capture. Build/check first or after, then clean-restart the dev server. See `.claude/skills/agent-wave/SKILL.md`'s Vite-corruption note for the same recipe (that skill also uses it, since Playwright-driven waves hit it too).
  - A page whose HTML truncates mid-stream with status 200 is an island SSR throw — check the served HTML's last tag, not just the status code.
  - Reviewers judging tall full-page captures may misreport "tiny text"; verify suspicious findings by Reading the shot yourself.
  - The dark rounded widget at bottom-center is Astro's dev toolbar, not app UI — at mobile widths it can visually sit on top of the real `nav.bottom-nav`, so don't mistake it for a tab-bar defect either.
- It restores user settings to defaults at the end. If you add pages/components, extend `MATRIX_PAGES`/`SINGLE_PAGES`/selectors in the script (the mobile pass reuses both maps, so it picks up new pages automatically).

## 3. Review — parallel Haiku agents

Spawn ~3 Haiku agents (model: haiku), splitting the shots into batches (theme-matrix dashboards, theme-matrix course/planner, everything else). Each agent Reads its images and reports per file: `filename — [severity] issue (spatially specific)` plus a clean-files list. Give each this checklist:

1. Low-contrast/unreadable text (especially dark scheme: dark-on-dark, light-on-light)
2. Overlap, clipping, overflow; popovers must sit on-screen below their trigger with shadow; modals must have a scrim
3. Unstyled raw-HTML regions (default blue links, fallback serif, unpadded lists)
4. Course-colored chips/bars legible in both schemes
5. Theme identity: focus = dense/indigo, campus = warm/cream, compass = neutral/teal; dark shots actually dark; flag identical-looking themes
6. Tab bar present with correct active tab on course pages
7. Sidebar states (expanded/collapsed) intentional; forms aligned; empty states designed
8. Narrow viewport stacks without horizontal scroll
9. Mobile shots (`mobile-390--*`): bottom nav present with the right active tab, sidebar actually gone (not just visually cramped), sheets bottom-anchored with a scrim (not a centered popover), planner/tasks read as a full page (no floating modal card, no visible scrim) — see `docs/design/mobile-shell.md`

Reviewers report only — they never edit files.

## 4. Triage, fix, re-verify

- Deduplicate findings across reviewers; discount subjective taste; keep concrete defects.
- Fix directly (styles live in `src/styles/tokens.css`, `base.css`, `themes/*.css`; component styles are scoped in each `.astro`/`.svelte`).
- Re-run the harness for affected pages only (temporarily trim the script's page maps) and eyeball the diffs yourself with Read, or send just the re-shots to one reviewer.
- `npm run build` + `npm test` must stay green. Kill the dev server when done.

## TODO
- Baseline/diff mode (compare against last accepted shots) once the UI stabilizes.
- Add axe-core accessibility pass to the harness.
- For hard layout invariants (no horizontal overflow, centered gutters, dashboard rail side-by-side/stacked, popovers on-screen, and — at its 390/430 mobile pass — bottom nav geometry, sidebar actually hidden, header not overflowing, sheets in-viewport, planner/tasks as full mobile pages) prefer `scripts/layout-check.cjs` (`npm run check:layout`) over a screenshot review — it's assert-based and exits non-zero, so it belongs in a regression-guard loop rather than a one-off visual pass. See `docs/architecture/overview.md`'s "Layout regression guard" section for invocation and re-baselining. Run both after layout-affecting changes: layout-check for invariants, this skill for anything that needs a human/LLM eye (contrast, spacing taste, theme identity) — this pairing is exactly how the planner mobile toolbar overflow (docs/todo.md) was found during the mobile-shell verification wave: layout-check's page-level overflow check correctly stayed green (the overflow is absorbed by the panel's own `overflow:auto`, its documented exemption for intentional scrollers), but eyeballing the `mobile-390--planner` shot caught the clipped view-toggle chip immediately.
