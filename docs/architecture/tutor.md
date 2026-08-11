# AI Tutor Architecture

## Overview

The AI tutor is a **server-side SSE stream** that adapts its pedagogy by KC type. It's headless (services + HTTP endpoints, `src/lib/services/tutor/` and `src/lib/flows/quick_quiz.ts`) so Flue agents can invoke the same functions later. Implemented in M4; this doc now describes the as-built system (see `docs/api.md` for the frozen-as-of-M4 request/response contract).

## Integration Points

- **Endpoints**: `POST /api/v1/tutor/conversations`, `GET /api/v1/tutor/conversations/:id`, `POST /api/v1/tutor/conversations/:id/messages` (SSE), `POST /api/v1/tutor/conversations/:id/end`.
- **Services**: `src/lib/services/tutor/openrouter.ts` (OpenRouter client + SSE relay + JSON-mode helper), `prompts.ts` (mode-derivation + system-prompt builder), `modelSpec.ts` (interactive-model parser + safe evaluator), `conversations.ts` (lifecycle: create/get/append+stream/end).
- **UI**: `src/components/tutor/ScaffoldChat.svelte` (streaming chat, any mode) + `InteractiveModel.svelte` (renders a parsed model spec inline when one arrives). Page: `src/pages/tutor/[kcId].astro`.
- **Event**: Ending a conversation (explicitly, or automatically at the message cap) appends a dual-role `tutor_session` event via `src/lib/services/events.ts` — the only place event rows are written.

## Mode Selection by KC Type

`modeForKcType` in `prompts.ts` implements the mapping from `docs/architecture/events-and-mastery.md`:

| kc_type | Mode | LLM Task |
|---------|------|----------|
| `fact` / `association` | `recall` | Flashcard-style retrieval questions + immediate feedback, gradually harder. |
| `concept` | `classify` | Variable-condition classification scenarios; feature-focusing feedback. |
| `rule` | `worked_example` | Full worked example → fading (student completes later steps) → independent practice. |
| `principle` | `interactive_model` (default) or `self_explain` | Socratic probing of *why*; `interactive_model` also emits a slider-driven model spec after a few exchanges. |

The client can override the derived mode at conversation creation (`POST /tutor/conversations {kc_id, mode?}`) — e.g. start a `principle` KC in plain `self_explain` if an interactive model doesn't make sense for it.

Each mode's system-prompt block (`MODE_INSTRUCTIONS` in `prompts.ts`) ends with the same reminder: close every turn with a retrieval question, and keep tone purely informational, calibrated to the KC's current mastery — the KLI asymmetry hypothesis, applied universally.

## OpenRouter Integration

`src/lib/services/tutor/openrouter.ts`:

- `streamChatCompletion({apiKey, model, messages})` — plain `fetch` to `https://openrouter.ai/api/v1/chat/completions` with `stream: true`; returns the upstream `response.body` untouched.
- `relayAsSSE(upstream, {onDone, onError})` — parses the upstream OpenAI-compatible SSE (`data: {choices:[{delta:{content}}]}` lines), re-emits our own minimal frames (`data: {"delta":"..."}\n\n`, then `data: {"done":true}\n\n`), and accumulates the full text. `onDone(fullText)` is **awaited before the stream closes** — on Workers, the response body isn't considered fully sent until the stream finishes, so this is how `conversations.ts` persists the assistant's message without an `ExecutionContext`/`waitUntil` wired up (that's still a TODO — see below).
- `chatCompletionJSON({apiKey, model, messages})` — non-streaming call, tries `response_format: {type:"json_object"}` first and falls back to a plain call if the routed model rejects it, then always re-parses the content through `extractJsonBlock` (direct parse → fenced ` ```json ` block → first balanced `{...}` span) since routed models don't reliably honor the format hint. Used by the `quick_quiz` flow for MCQ generation.
- Model: `env.OPENROUTER_MODEL` (wrangler var, default `openrouter/auto`). Key: `env.OPENROUTER_API_KEY` (`.dev.vars` locally, `wrangler secret` in deployment — **not set in this repo's `.dev.vars` as of M4**, see Verification below).
- Cost bounding: `MAX_MESSAGES_PER_CONVERSATION = 30` in `conversations.ts` (user+assistant combined). Reaching it auto-ends the conversation after the capping exchange finishes; posting further returns `400 conversation_capped`.

## Context Assembly

`assembleTutorContext` in `conversations.ts` gathers, server-side, before every LLM call:

- KC name, `kc_type`, `description`, `practice_notes`.
- Branch name and course title/overview (direct `branches`/`courses` lookups by the KC's foreign keys).
- Current `mastery`/`status` (read straight off the KC's cached columns).
- The last 5 events for the KC (`getKcEvents`, summarized as `type` + date + a short outcome tag read from payload).
- Any notes linked to the KC via `note_links`, bodies truncated to 500 chars.

`prompts.ts::buildSystemPrompt` turns that into the system message; `conversations.ts` prepends it to the persisted message history (which only ever contains `user`/`assistant` roles — the system prompt itself is never persisted, since it's rebuilt fresh each turn from current context, e.g. mastery may have moved since the last message).

## Interactive Model Spec

Format, grammar, and the parser/evaluator live in `src/lib/services/tutor/modelSpec.ts` (full JSON shape and rules are in `docs/api.md`'s AI Tutor section — not duplicated here to avoid drift). Key implementation facts:

- `extractModelSpec(text)` looks for one fenced ` ```json ` block and validates it with a Zod schema; any failure (missing block, invalid JSON, schema mismatch) returns `null` and the message is rendered as plain prose — this is the "degrade gracefully" path from the plan.
- `evaluateExpression(formula, vars)` is a hand-rolled recursive-descent parser (tokenize → `parseExpr`/`parseTerm`/`parseUnary`/`parsePower`/`parsePrimary`), **not** `eval`/`Function`/`math.js`. Supported grammar: `+ - * / ^ ( )`, functions `sqrt sin cos tan log exp abs`, constants `pi e`, and whatever parameter ids the spec declared — nothing else parses (unknown identifiers/functions throw `ExpressionError`).
- `evaluateModelSpec(spec, values)` runs every expression and returns `{id, label, value}` or `{id, label, value: null, error}` per-expression, so one bad formula doesn't blank the whole panel.
- This module has **no server-only imports**, so `InteractiveModel.svelte` imports it directly and re-evaluates client-side as sliders move — the exact same evaluator the server would use to validate, with no round-trip needed for recomputation.

## Conversation Lifecycle

1. **Create**: `POST /tutor/conversations {kc_id, mode?}` → `createConversation` derives mode from `kc_type` (or uses the override) and inserts a `tutor_conversations` row.
2. **Message stream**: `POST /tutor/conversations/:id/messages {content}` → `appendMessageAndStream`: persists the user message, assembles fresh context, builds the system prompt, streams the completion, and relays it as SSE while persisting the assistant reply in `onDone`. `GET /tutor/conversations/:id` returns the full transcript for resume/review — `tutor_messages` rows persist indefinitely.
3. **Close**: explicit `POST /tutor/conversations/:id/end {final_rating?}`, or automatic once the message cap is reached — both append one `tutor_session` event (`payload: {conversation_id, mode, final_rating?}`) via the events service and trigger the KC's mastery re-fold.

## Cost & Safety

- **Per-conversation cap**: 30 messages (configurable in `conversations.ts`), enforced server-side, not just a UI suggestion.
- **Model selection**: `OPENROUTER_MODEL` var, default `openrouter/auto` (OpenRouter's own router) — swap to a fixed cheap model id if cost needs tighter control.
- **Prompt injection**: user input is passed as a `user`-role chat message, never interpolated into the system prompt string or into an expression formula — the model-spec evaluator only ever sees LLM-authored formulas over declared parameter ids, and rejects anything else.
- **Expression safety**: hand-rolled parser, no `eval`/`Function`/dynamic code execution anywhere in the request path (unit-tested in `tests/tutor-modelSpec.test.ts`, including that global identifiers like `globalThis` are rejected as unknown, not silently resolved).

## Verification status (M4)

- `npm run build` and `npm run test` (vitest, `@cloudflare/vitest-pool-workers`) are clean — see `tests/tutor-modelSpec.test.ts`, `tests/tutor-openrouter.test.ts`, `tests/tutor-conversations.test.ts`, `tests/quick-quiz.test.ts`.
- **No `OPENROUTER_API_KEY` is set in this repo's `.dev.vars`** (only `.dev.vars.example` exists, with the key blank) — so there has been no live call to OpenRouter. All tutor/flow tests mock `fetch` to verify the SSE relay, JSON-mode parsing, mode derivation, message persistence, cap/auto-end behavior, and quiz generation/grading end-to-end against the mocked responses. Live verification (real prompt quality, actual model-spec emission rate, real streaming latency) is a TODO once a key is available.

## TODO

- **Live OpenRouter verification** once `OPENROUTER_API_KEY` is set locally (see above).
- **ExecutionContext/`waitUntil`**: `Astro.locals.cfContext` isn't wired up anywhere in the codebase yet (checked as of M4). Assistant-message persistence currently relies on the SSE relay's `onDone` being awaited before the stream closes, which works because Workers keeps the response body open until then — but a real `waitUntil` would be more robust once the adapter exposes `ExecutionContext` to Astro pages.
- **Adaptive difficulty**: track in-conversation performance and adjust question complexity turn-to-turn (currently only the KC's *stored* mastery calibrates difficulty, not the conversation's own trajectory).
- **Mode switching**: let the tutor suggest switching modes mid-conversation if the student isn't progressing.
- **Multi-turn planning**: let the tutor plan a multi-turn lesson arc instead of one turn at a time.
- **Knowledge map integration**: use prerequisite edges (once they exist) to proactively teach foundational KCs.
- **`quick_quiz` storage**: reuses `study_sessions.reflection` as a JSON blob (documented in `docs/api.md`) rather than a dedicated table — revisit if quizzes need richer item types.
