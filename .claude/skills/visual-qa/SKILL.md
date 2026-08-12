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
- Credentials: seeded user `student@example.com` / `studybuddy` (override with `VQA_EMAIL`/`VQA_PASSWORD`).
- Output dir: use the session scratchpad, not the repo.

## 2. Capture — `scripts/visual-qa.mjs`

The harness logs in via the API and captures (~43 shots):
- **Theme matrix**: dashboard, course overview, planner, settings × {compass, focus, campus} × {light, dark} — theme/scheme set via `PATCH /api/v1/user {settings:{theme,scheme}}`.
- **Single-pass (compass/light)**: courses index, all six course tabs, feed, tasks, notes, profile, login (unauthenticated).
- **Interaction states**: each header popover (bell `button[title="Notifications"]`, todo `button[title="To-do"]`, scratchpad `button[title="Scratchpad"]`, avatar `button.avatar`), Record-event modal, Add-course modal, collapsed sidebar (`data-sidebar="collapsed"`), narrow 820px viewport.
- It also collects JS console/page errors — treat any as a finding.
- **Gotchas**: a corrupted Vite deps cache (404 on `@astrojs_svelte_client` → no island hydrates, clicks do nothing) means `astro dev stop && rm -rf node_modules/.vite && astro dev --force`. A page whose HTML truncates mid-stream with status 200 is an island SSR throw — check the served HTML's last tag, not just the status code. Reviewers judging tall full-page captures may misreport "tiny text"; verify suspicious findings by Reading the shot yourself. The dark rounded widget at bottom-center is Astro's dev toolbar, not app UI.
- It restores user settings to defaults at the end. If you add pages/components, extend `MATRIX_PAGES`/`SINGLE_PAGES`/selectors in the script.

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

Reviewers report only — they never edit files.

## 4. Triage, fix, re-verify

- Deduplicate findings across reviewers; discount subjective taste; keep concrete defects.
- Fix directly (styles live in `src/styles/tokens.css`, `base.css`, `themes/*.css`; component styles are scoped in each `.astro`/`.svelte`).
- Re-run the harness for affected pages only (temporarily trim the script's page maps) and eyeball the diffs yourself with Read, or send just the re-shots to one reviewer.
- `npm run build` + `npm test` must stay green. Kill the dev server when done.

## TODO
- Baseline/diff mode (compare against last accepted shots) once the UI stabilizes.
- Add axe-core accessibility pass to the harness.
