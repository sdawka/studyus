---
name: agent-wave
description: Orchestrate a parallel agent-team build wave in this repo — ownership boundaries, environment quirks, commit protocol, and verification gates. Use when implementing a multi-track feature plan with Sonnet/Haiku subagents.
---

# Agent build wave (studyus conventions)

How this repo runs multi-agent implementation waves (used for v1 M0–M5 and v1.1 P0–P3).

## Sequencing

1. **Foundation first, alone**: schema/migrations, shared contracts (tokens, layout slots, API shapes) land in one sequential agent. Freeze contracts in `docs/api.md` before parallelism.
2. **Parallel wave**: 3–5 agents with **disjoint file ownership** — list owned paths explicitly in each prompt; everything else is read-only. Cross-track handoffs go through a named contract (component props, custom events, API shapes), never shared edits.
3. **Retirement/verify phase**: one final agent removes compat shims, sweeps remnants, runs the full verification gate.

## Per-agent prompt must include

- Task-board id to mark in_progress/completed (TaskUpdate).
- Node: as of 2026-08-19 nvm is BACK (`~/.local/bin` node is gone again; system default is nvm's v20.20.2, which wrangler refuses). Prefix every shell command with `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"` (matches .nvmrc; v22/v26 also installed). This has now flipped twice — probe `node --version` at wave start instead of trusting this note, and update it when it drifts. Playwright's old "global under Node 20" install died with nvm — install it in the session scratchpad (`npm init -y && npm i playwright`); browser binaries persist in `~/Library/Caches/ms-playwright`.
- `astro dev` in this repo is a **single-instance daemon**, not an ordinary long-running process — `astro dev status/stop/logs` manage the one running server, and a second `astro dev` call does not open a second port. Only one agent can hold the dev slot at a time; the orchestrator serializes it across the wave (assign it to one agent at a time, e.g. the live-walk/verification agent) rather than handing out "unique ports" per agent. **Never stop a server you didn't start** — check `astro dev status` before stopping, and if it's already running for someone else, wait or coordinate instead of killing it. Note: a stale Vite deps cache can still corrupt state across restarts (symptom: 404 on `@astrojs_svelte_client` → no island hydrates and clicks do nothing, or SSR 500s citing missing `deps_ssr/` files) — the fix is a **full cold-cache recovery**, not just a plain restart:
  1. `astro dev stop`.
  2. Clear all three caches: `rm -rf node_modules/.vite node_modules/.astro .astro` — the project-local `.astro/` content-layer cache is easy to forget alongside the shared `node_modules/.vite` deps cache; a partial clear can leave the corruption in place.
  3. Restart with `astro dev --force` (background).
  4. `curl` a couple of pages (e.g. `/login`, `/dashboard`) to force Vite to re-optimize dependencies and warm the route cache **before** pointing Playwright (layout-check or visual-qa) at it — a Playwright run against a still-cold server reads as the same "island didn't hydrate" symptom and gets misdiagnosed as a real bug rather than a cache-warming race.
  Root cause: running `npm run build` — or `astro check` / `npm run check` — while a dev server is live corrupts the shared cache; never run either mid-capture/mid-check. Build/check first or after, then clean-restart. Same recipe is documented in `.claude/skills/visual-qa/SKILL.md`'s gotchas section.
- Login: `student@example.com` / `studyus` (seed default; the pre-rename `studybuddy` hash died with the 2026-08-13 DB wipe + reseed — any future wipe+reseed keeps `studyus`). Curl calls with unsafe methods need `Origin: http://localhost:<port>` (Astro CSRF).
- `npm run check:layout` defaults its login password to `studyus` (tracks the seed default in `scripts/layout-check.cjs`) — only set `LAYOUT_CHECK_PASSWORD` if that default ever drifts from the seeded password again. Because the dev daemon is single-instance, **don't run `check:layout` from two agents concurrently** — it drives the one shared dev server through a full page/viewport matrix and concurrent runs will corrupt each other's session state (sidebar localStorage, login cookies) and produce false failures.
- **No commits, no pushes** — the orchestrator commits each track by explicit path list when the agent's report is accepted (prevents `git add -A` sweeping other agents' WIP). Exception: single-agent phases may commit with an exact message, never push.
- NO deploys — local wrangler only.
- Verification expectations: `npm run build` clean, `npm test` green, live dev-server walk of the built feature, then a written report (files, verification output, deviations, contracts downstream agents need).

## Orchestrator duties

- Commit per accepted track: `git add <owned paths> && git commit -m "<phase>: <summary>"`, push after each.
- Relay cross-track breakage immediately (agent A's build break blocks agent B — diagnose yourself if trivial, e.g. a one-line Svelte syntax fix).
- Don't accept "done" without green verification; send back with specific diagnoses rather than re-explaining the task.
- Accumulate small findings into the final phase's task description instead of interrupting the wave.
- After the wave: run `/visual-qa`.

## Lessons from the v1.6 wave (2026-08-15)

- **Wall-clock vs workerd-UTC**: the dev server (workerd) runs in UTC while the browser is local-time. Any entity whose time is a wall-clock fact (class start times) must travel as minutes-from-midnight (`details.start_min`) and be positioned/labeled client-side from those minutes — never by calling local Date getters on a server-built ISO. Full contract note in docs/api.md's class_session section.
- **Fetch-window vs display-window mismatch**: a widget that displays a rolling window (WeekGrid's sub-7-day anchor mode) must fetch the same window. A Monday-anchored fetch under a rolling display silently drops days late in the week — blocks vanish with zero errors. Grep for `mondayOf`-style anchors when a grid shows empty columns the API can fill.
- **Transient attendance marks leave sweep residue**: marking a class_session `attended` — even briefly, in a test — makes the sweep generate a `review_after_class` task that does NOT retract when the mark reverts. Test runs must clean these up by hand.
- **Subagents may go idle without delivering their final report** — nudge with a SendMessage asking them to send the report to "main"; treat an idle notification with no report as undelivered, not as empty.
- **Verify visual-qa captures actually captured**: byte-identical file sizes between an interaction shot and its base page mean the interaction silently failed (the expand-gate existence-check bug). The harness now gates on `aria-expanded`.

## Lessons from the v1.7 wave (2026-08-16)

- **Task-board owner strings collide with cross-session agent names**: the board is shared across local Claude sessions. Setting a task's `owner` to a generic name ("foundation") that happens to be another session's live agent makes that agent adopt the task as its own. Use wave-unique owner names, and verify the spawn-returned agent name matches the owner string you set (a taken name gets auto-suffixed, e.g. "foundation-2").
- **Sandbox blocks teammate-instructed destruction, and tunneling it through the orchestrator is also blocked**: `rm -rf` of git-tracked files (the migrations/ single-baseline regen) requires the actual user's fresh authorization even when a standing convention documents it. Don't work around it — ship the additive equivalent, flag the deviation for the user, move on.
- **Idempotent upsert seeds need explicit purge logic when a new source format supersedes an old one**: the content.json path left all 123 legacy-namespace KC/branch/resource rows coexisting with the 147 new ones (and legacy demo assessments broke weight sums). Delete by computing the exact legacy deterministic ids; verify with row-count queries after any seed-source migration, not just "seed ran clean".
- **All 3 Haiku vqa reviewers went idle without delivering reports** (3/3, worse than v1.6) — budget a nudge round into every review fan-out. They also passed shots containing a single-line-ellipsis convention violation the orchestrator caught by eye — the "spot-check flagship shots yourself" rule is load-bearing.

## Lessons from the v1.8 marketing wave (2026-08-16)

- **Stale HMR error overlay poisons the first Playwright connection**: server-side errors logged earlier in the dev daemon's life (e.g. failed queries against an unmigrated local D1) get replayed to the *next* browser client as a full-viewport `vite-error-overlay`, even when the page's SSR HTML is clean — a full-page capture then shows an error panel where the hero should be. `curl` the route and grep for the error string to tell "server actually broken" from "overlay replaying history"; a second connection is clean. Also: capture full-page shots under `reducedMotion: 'reduce'` when the page uses IntersectionObserver reveals — below-fold observers don't fire in fullPage shots, so motion-gated content would screenshot as blank.
- **The dev daemon ignores `--port` and picks its own** (asked for 4399, got 4400) — read the port from the daemon's startup log line, never assume. Multiple unrelated dev servers squat on nearby ports (4321, 4399 were both foreign apps whose `/` returns 200), so a "the page 404s" symptom may mean you're curling someone else's server entirely.
- **Astro's Cloudflare adapter snapshots wrangler.jsonc at build time** (config-redirect into the build output): editing `database_id`/bindings after building and then running `wrangler deploy` still deploys the OLD config. Rebuild after any wrangler.jsonc change, then deploy. First-deploy checklist that worked: `wrangler d1 create` → paste real `database_id` → `npm run db:migrate:remote` → `npm run build` → `wrangler deploy`; changing `database_id` re-keys miniflare's local D1 storage, so re-run `db:migrate:local` + `db:seed` afterward to restore local dev.
- **All 3 Haiku vqa reviewers delivered reports without a nudge** (first time — prompts ended with an explicit "Send your findings via SendMessage to main" as the final instruction, which may be why).

## Lessons from the v1.9 wave (2026-08-19, rituals/capabilities/ZPD)

- **D1's 100-bound-parameter cap bites whole-profile queries**: a single `inArray()` over all of a user's KCs (147 ids) 500s at runtime while every test (small fixtures) stays green. Chunk `inArray` id-lists to ≤100 and union. Grep any new service that queries at profile scope rather than course scope.
- **Live-walk API pokes leave residue like test attendance marks do** (v1.6 lesson generalizes): the verify agent's POSTed test ritual seeded 8 sweep tasks that then showed up in visual-qa shots as a fake defect surface. Verify-phase walks must delete what they create (cascade FKs help), and the orchestrator should re-check the DB before capture.
- **Phantom task_assignment messages hit wave agents again** (a completed track got "reassigned" its own done task) — agents should treat an assignment for an already-completed task they own as a glitch to flag, not redo; the orchestrator confirms.
- **All 3 Haiku vqa reviewers delivered unprompted again** when the prompt's literal last sentence is "Your FINAL action MUST be SendMessage to main" — two waves running; keep the pattern.
- **Sweep-generated tasks carry UI semantics**: anything minted for a *past* moment inherits the tasks list's red "overdue" framing. For informational/no-guilt features (rituals), mint backfill pre-dismissed and auto-expire stale occurrences in the sweep — state design, not CSS, is what enforces anti-gamification.
- **Wire-shape seam at .astro page boundaries**: services return camelCase rows, Svelte panels are typed against snake_case Zod wire shapes — bridge with `toApi()` in the page frontmatter (see profile.astro), don't hand-map.

## Lessons from the v2.0 wave (2026-08-20, exercise banks / content research)

- **Teammate agents' own subagent results route to the ORCHESTRATOR's session, not the teammate** — a researcher that fans out never hears back from its children. Protocol that works: subagents WRITE output to a unique scratchpad file and return only the path + counts; the researcher polls for files. When a payload does land on the orchestrator, extract it from the child's transcript JSONL (parse lines, walk string values for the payload) into a relay file — don't paste 25k-token payloads through SendMessage.
- **LLM-authored MCQs put the correct answer first** — 323/392 across 7 of 9 authoring agents (the two that shuffled did so on their own). Post-hoc fix needs option shuffling PLUS letter-reference remapping in explanations ("Option B"), plus an audit that scenario-internal letters (Gas A, ln(A), Material B) aren't touched. Cheaper: bake "vary correct_index; reference options by content not letter" into the authoring contract up front (now in courses/exercise-schema.md).
- **Content validation is a different gate than structural validation** — Zod caught slugs/shapes; only the Haiku recompute-the-answers pass caught the answer-position bias, and only a human-eye spot-check of a live page caught mid-walk event residue. Sample-validate content with agents that actually recompute, and screenshot with your own eyes after any live walk.
- **Seed-time Zod as the merge gate works**: strict schema + validate-or-abort seed caught tolerance_pct edge cases and non-kebab slugs across 9 independently-authored files with zero silent corruption.

## TODO
- Consider worktree isolation per agent if track ownership ever must overlap.
