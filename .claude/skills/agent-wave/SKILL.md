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
- `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"` prefix for node/npm/npx/wrangler (system node is v20; app needs ≥22).
- `astro dev` in this repo is a **single-instance daemon**, not an ordinary long-running process — `astro dev status/stop/logs` manage the one running server, and a second `astro dev` call does not open a second port. Only one agent can hold the dev slot at a time; the orchestrator serializes it across the wave (assign it to one agent at a time, e.g. the live-walk/verification agent) rather than handing out "unique ports" per agent. **Never stop a server you didn't start** — check `astro dev status` before stopping, and if it's already running for someone else, wait or coordinate instead of killing it. Note: a stale Vite deps cache can still corrupt state across restarts — fix is `astro dev stop`, clear `node_modules/.vite`, restart with `--force`.
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

## TODO
- Consider worktree isolation per agent if track ownership ever must overlap.
