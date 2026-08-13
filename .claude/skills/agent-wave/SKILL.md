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
- A **unique dev-server port** (4340+ range; `astro dev --port N`); kill it when done. Note: parallel dev servers occasionally corrupt the Vite deps cache — fix is `astro dev stop`, clear `node_modules/.vite`, restart with `--force`.
- Login: `student@example.com` / `studyus` (seed default; the pre-rename `studybuddy` hash died with the 2026-08-13 DB wipe + reseed — any future wipe+reseed keeps `studyus`). Curl calls with unsafe methods need `Origin: http://localhost:<port>` (Astro CSRF).
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
