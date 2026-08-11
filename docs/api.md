# StudyBuddy API — FROZEN v1 (M1, 2026-08-11)

**Status**: FROZEN v1. This is the contract the iPad client (and any other native/agentic caller) builds against. Changes after this point are additive-only (new optional fields, new endpoints) unless a new major version is introduced. `tutor/*` and `flows/*` were reserved for M4 and are now implemented — see those sections below (the streaming message endpoint and the `end`/quick_quiz-answers endpoints return a non-`{data}` or additive shape respectively, called out where relevant).

**Base URL**: `/api/v1`

**Auth**: Session-based via HttpOnly cookie, name `studybuddy_session` (not `session_token` — corrected from the draft). Unauthenticated requests to any `/api/v1/*` route other than `/api/v1/auth/*` → `401 Unauthorized`.

**Envelope** (unchanged from draft):
```json
{ "data": { /* response body */ } }
```
or on error:
```json
{ "error": { "code": "invalid_input", "message": "..." } }
```
Error `code`s in use: `invalid_input` (400, includes Zod validation failures), `unauthorized` (401), `forbidden` (403), `not_manual_event` (400 — see Events below), `not_found` (404), `internal_error` (500), `conversation_capped` (400 — see AI Tutor below), `quiz_generation_failed` (502 — see Agentic Flows below), `quiz_not_gradable` (400 — see Agentic Flows below).

**IDs**: All entity ids are UUID-*shaped* strings (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, lowercase hex) but are **not guaranteed to be valid RFC4122 v4 UUIDs** — seed data uses deterministic UUID-shaped hashes (stable across reseeds) that don't set the version/variant nibits real UUIDs do. Clients must treat ids as opaque strings matching that grouping, not validate strict UUID version.

**Timestamps**: Every response field ending in `_at`/`_date`, plus `ts`, is an ISO 8601 datetime string. Internally these are stored as epoch-ms integers and converted at the API boundary (`src/lib/serialize.ts::toApi`) — this is the one place that conversion happens, so it's always applied.

---

## Authentication

### POST /auth/login
**Request**:
```json
{ "email": "string", "password": "string" }
```
(Corrected from draft's `username` — the `users` table is keyed by `email`.)

**Response** (200):
```json
{ "data": { "user": { "id": "uuid", "email": "string", "name": "string|null" } } }
```
**Errors**: `401 unauthorized` (wrong credentials), `400 invalid_input` (missing/malformed fields). Sets the `studybuddy_session` HttpOnly cookie.

### POST /auth/logout
**Response** (200): `{ "data": { "ok": true } }`

---

## User

### GET /user
**Response** (200):
```json
{ "data": { "id": "uuid", "email": "string", "name": "string|null", "current_term": "string|null" } }
```

### PATCH /user
**Request**: `{ "name": "string?", "current_term": "string?" }`
**Response** (200): updated user object (same shape as GET).

---

## Courses

### GET /courses
**Query**: `include=mastery` (optional) — adds `mastery` (0-100, rollup average of the course's KC mastery caches) and `status` (`not-started|learning|review|mastered`) to each course. Without it, both fields are `null`.

**Response** (200): array of course objects — all `courses` table columns in snake_case, plus `mastery`/`status`.

### GET /courses/:slug
Course + branches + KCs (matches draft shape exactly: `{ ...course, branches: [{ ...branch, kcs: [...] }] }`).

### GET /courses/:id/assessments
Lists assessments for the course (note: **:id is the course id, not slug** — this endpoint and the detail endpoint above use different path params intentionally, matching the original plan).

### POST /courses/:id/assessments
**Request** (extends draft — adds optional `kc_ids` to link the assessment to KCs at creation time, so a later grade entry knows which KCs to score):
```json
{ "title": "string", "type": "quiz|assignment|midterm|final|lab", "due_date": "iso?", "weight_pct": "number 0-100?", "kc_ids": ["uuid"]? }
```
**Response** (201): the created assessment row.

### PATCH /assessments/:id
**Request** (unchanged from draft, plus `grade_max` is settable):
```json
{ "title": "string?", "type": "...?", "due_date": "iso|null?", "weight_pct": "number|null?", "grade_received": "number|null?", "grade_max": "number|null?" }
```
**Response** (200): `{ ...updatedAssessment, "mastery_deltas": [{ "kc_id", "old_mastery", "new_mastery" }] }`. `mastery_deltas` is populated (one entry per linked `assessment_kcs` row) only when this PATCH is the one that *sets* `grade_received` to a new value — that's the trigger that auto-appends one assessment-role event (`quiz_taken`/`assignment_graded`/`exam_graded` depending on assessment `type`) per linked KC via the events service. Re-patching other fields (title, due date, etc.) returns an empty `mastery_deltas: []`.

### DELETE /assessments/:id
**Response** (200): `{ "data": {} }`

---

## Knowledge Components (KCs)

### GET /kcs/:id
Matches draft shape exactly.

### PATCH /kcs/:id
Matches draft (`name`, `kc_type`, `description`, `practice_notes`, all optional).

### GET /kcs/:id/events
**Query**: `limit` (default 20), `offset` (default 0). Response: array of event objects (see Events below for the event shape).

---

## Events

Single source of truth for the type → role-flag (`is_instructional`/`is_assessment`) mapping is `src/lib/schemas/events.ts::EVENT_ROLE_FLAGS`:

| type | is_instructional | is_assessment |
|---|---|---|
| lecture_attended, lecture_missed, video_watched, reading_done, taught_someone | true | false |
| quiz_taken, assignment_graded, exam_graded, self_assessment | false | true |
| practice_done, retrieval_practice, tutor_session | true | true |

### POST /events
**Request**:
```json
{ "type": "<one of the 12 types above>", "kc_id": "uuid?", "course_id": "uuid?", "ts": "iso?", "payload": {}? }
```
`is_instructional`/`is_assessment` are **always derived server-side from `type`** — they are not client-settable (this differs from the draft's request shape, which listed them as request fields; they're response-only). `source` is always `"manual"` for events created through this endpoint.

**Response** (201): `{ ...event, "mastery_deltas": [...] }`. `mastery_deltas` has zero or one entries — one iff `kc_id` was provided (each event has at most one KC).

### GET /events
**Query**: `course=uuid?`, `kc=uuid?`, `limit` (default 20, max 200). Response: array of event objects, newest first.

### PATCH /events/:id
**Manual-source only.** Attempting to PATCH a `session`/`tutor`/`seed`-sourced event returns `400 not_manual_event`. Changing `type` re-derives the role flags. Response: `{ ...event, mastery_deltas }`.

### DELETE /events/:id
Allowed for **any** source (system-generated events are delete-only, per the plan — the confirmation step is a client UX concern, not server-enforced). Response: `{ "data": { "mastery_deltas": [...] } }`.

---

## Calendar & Grades

### GET /calendar
**Query**: `from`, `to` (both required ISO datetimes), `course=uuid?`.

**Deviation from draft**: implemented item `type`s are `assessment_due` and `task_due` only. `study_session` and `lecture` calendar items (scheduled/planned sessions, timetabled lectures) are **not implemented in M1** — there's no "scheduled lecture" concept in the data model yet, and study sessions are logged retroactively rather than planned ahead. Left as a TODO for M2/M3 if a planning view needs it.

```json
{ "data": [{ "id": "uuid", "type": "assessment_due|task_due", "title": "string", "date": "iso", "course_id": "uuid|null", "details": {} }] }
```

### GET /grades/summary
**Deviation from draft**: the draft's `overall_gpa` field is replaced with **`overall_weighted_grade`** — a credit-weighted average of each course's `weighted_grade` (courses with no graded assessments are excluded from the average, not counted as 0). There's no grade-point-scale mapping in the data model, so a real GPA can't be computed; this is the honest equivalent. Per-course `weighted_grade` is `sum(grade% x weight_pct) / sum(weight_pct)` over assessments that have `grade_received` set, `null` if none are graded yet.

```json
{ "data": { "overall_weighted_grade": 87.5, "by_course": [{ "course_id", "course_title", "weighted_grade", "assessments": [...] }] } }
```

---

## Tasks

### GET|POST /tasks
Matches draft. Response `completed` maps to the internal `done` column name; `courses` is `[{ id, code }]`.

### PATCH|DELETE /tasks/:id
`PATCH` body accepts `title?`, `description?`, `due_date?`, `completed?`, `course_ids?` (replaces the full set of linked courses when provided).

---

## Notes

### GET|POST /notes
Matches draft (`content` maps to the internal `body` column name). `POST` body: `{ title, content, links?: [{ course_id?, kc_id? }] }`.

### GET|PATCH|DELETE /notes/:id
`GET`/response shape includes `links: [{ course_id, kc_id }]`. `PATCH` replaces the full link set when `links` is provided.

---

## Resources (Feed)

### GET /resources
Matches draft (`course=uuid?`, `kind=canonical|feed|user_shared?`).

### POST /resources
Matches draft request shape. **Always creates `kind: "user_shared"`** regardless of any other value — `canonical`/`feed` resources are seed-only and not client-creatable.

### DELETE /resources/:id
Matches draft.

---

## File Uploads (R2)

### POST /courses/:id/attachments
Matches draft (`multipart/form-data`, field `file`). R2 key convention: `{userId}/{courseId}/{uuid}-{sanitized-filename}`.

### GET|DELETE /attachments/:id
Matches draft. `GET` streams the object body with the stored `Content-Type` and a `Content-Disposition: inline` header.

---

## Study Sessions

### GET|POST /sessions
Matches draft. `intended_event_type` is a free string; on completion it's resolved to one of the 12 event types if it matches exactly, otherwise falls back to `practice_done` (dual-role) so a completed session always registers as some evidence of study even if the client sent an unrecognized label.

### PATCH /sessions/:id/complete
Matches draft. `kc_ids_touched` defaults to whatever KCs were linked at session creation (`session_kcs`) if omitted. Appends one event per touched KC via the events service.

---

## AI Tutor (M4)

Server-side OpenRouter integration (`src/lib/services/tutor/{openrouter,prompts,modelSpec,conversations}.ts`). Mode is derived from the KC's `kc_type` per the KLI mapping in `docs/architecture/events-and-mastery.md` (`fact`/`association`→`recall`, `concept`→`classify`, `rule`→`worked_example`, `principle`→`interactive_model` by default, with `self_explain` available as an explicit override) unless the client passes `mode` explicitly at creation.

### POST /tutor/conversations
**Request**: `{ "kc_id": "uuid", "mode": "recall|classify|worked_example|self_explain|interactive_model"? }`

**Response** (201): the created `tutor_conversations` row (`id`, `kc_id`, `mode`, `created_at`).

### GET /tutor/conversations/:id
**Response** (200): `{ ...conversation, "messages": [{ id, role, content, created_at }] }`, messages oldest-first.

### POST /tutor/conversations/:id/messages
**Request**: `{ "content": "string" }`. **Response**: `text/event-stream`, not the `{data}` envelope — each frame is `data: {"delta":"..."}\n\n`, terminated by `data: {"done":true}\n\n`. The user message is persisted immediately; the assistant's full reply is persisted once the stream completes.

Per-conversation message cap: **30** (`MAX_MESSAGES_PER_CONVERSATION` in `conversations.ts`), user+assistant combined. Once an exchange would reach the cap, the conversation is auto-ended (see below) after that reply streams. Posting to an already-capped conversation returns `400 conversation_capped` instead of a stream.

### POST /tutor/conversations/:id/end — additive, beyond the original plan draft
**Request**: `{ "final_rating": 1-5? }`. Appends one dual-role `tutor_session` event (`payload: { conversation_id, mode, final_rating? }`) via the events service and returns `{ conversation, event, mastery_deltas }`. Also fired automatically when the message cap is reached — the client button just exposes the same action. Not idempotency-guarded: calling it twice appends two events (each representing a distinct self-assessment/close), same as the `tutor_session` events a Flue channel agent would append per session-close.

### Interactive model spec (principle KCs, `interactive_model` mode)
The tutor may emit at most one fenced ` ```json ` block per message, validated against `modelSpecSchema` in `src/lib/services/tutor/modelSpec.ts`:
```json
{
  "title": "string?",
  "parameters": [{ "id": "string", "label": "string?", "min": 0, "max": 50, "step": 1?, "default": 10, "unit": "string?" }],
  "expressions": [{ "id": "string", "label": "string?", "formula": "string" }],
  "notes": "string?"
}
```
Formulas are evaluated by a hand-rolled recursive-descent parser (no `eval`/`Function`) supporting only `+ - * / ^ ( )`, the functions `sqrt sin cos tan log exp abs`, and the constants `pi e` plus the declared parameter ids. Parse or validation failure degrades silently to `null` — the client renders the message as plain prose. `InteractiveModel.svelte` re-evaluates all expressions client-side as sliders move, using the same parser (it has no server-only imports).

### Context assembly
Before every LLM call, `conversations.ts` assembles: KC name/type/description/practice_notes, branch name, course title/overview, current mastery/status, the last 5 events for the KC (summarized), and any notes linked to the KC (bodies truncated to 500 chars) — injected into the system prompt built by `prompts.ts`. Every mode's prompt ends with an instruction to close the turn with a retrieval question (the KLI asymmetry hypothesis: spaced retrieval helps for every KC type) and to keep tone purely informational, calibrated to current mastery.

## Agentic Flows (M4)

### POST /flows/quick_quiz
**Request**: `{ "course_id": "uuid"?, "kc_id": "uuid"?, "count": 1-10? (default 5) }`. If `kc_id` is given, the quiz is that one KC; otherwise KCs are picked by lowest `mastery` then oldest (or never-touched) `last_event_at`, optionally scoped to `course_id`, across the user's owned KCs.

**Response** (201): `{ "id": "uuid", "questions": [{ "index": 0, "kc_id": "uuid", "question": "string", "options": ["string", "string", "string", "string"] }] }` — **no answers or explanations included**.

**Storage** (documented per the plan's "your call"): quizzes reuse a `study_sessions` row rather than a new table. `intended_event_type` is set to the sentinel `"quick_quiz"` (not a real event type — `PATCH /sessions/:id/complete` is never called on these rows). The generated items (with correct answers + explanations) are JSON-stringified into the otherwise-unused `reflection` text column; `session_kcs` links the picked KCs, same as a real study session.

### POST /flows/quick_quiz/:id/answers
**Request**: `{ "answers": [{ "question_index": 0, "selected_index": 0 }] }`.

**Response**: `{ "id": "uuid", "score": 0-100, "results": [{ "question_index", "kc_id", "correct", "correct_index", "explanation" }], "mastery_deltas": [...] }`. Grading appends one dual-role `retrieval_practice` event per KC (`payload: { correct, session_id, channel: "quick_quiz" }`) via the events service, and rewrites the session's `reflection` blob with the graded answers + score, setting `ended_at`. Re-submitting an already-graded quiz returns `400 quiz_not_gradable`.

Both flow functions are `(db, userId, input, env) -> result` with no route-handler logic inside them (`src/lib/flows/quick_quiz.ts`) — the shape a future Flue tool wraps unchanged, per `docs/architecture/agentic-channels.md`.

---

## Profile (Aggregation)

### GET /profile
Matches draft exactly:
```json
{
  "data": {
    "user_id": "uuid",
    "overall_mastery": 65,
    "by_course": [{ "course_id", "course_title", "mastery" }],
    "longest_streak": 15,
    "current_streak": 3,
    "recent_events": [ /* last 20 events, newest first */ ],
    "knowledge_map": null
  }
}
```
`current_streak`/`longest_streak` are consecutive-day counts (UTC calendar days with >=1 event); `current_streak` is 0 unless the most recent event day is today or yesterday. `knowledge_map` is an explicit `null` TODO stub per the plan — no implementation planned until post-M5.

---

## Mastery fold (reference)

Implemented in `src/lib/services/mastery.ts::foldMastery` — pure function `(events, now) -> { mastery, status, lastEventAt }`, re-run in full on every event create/update/delete (no incremental state). Summary:

1. **AE component**: each assessment-role event contributes a `[0,1]` success value (read from `payload.correct`/`correctness`/`score`/`self_rating`, defaulting to `0.7` if none present), averaged with a recency weight (30-day half-life — recent attempts count more).
2. **IE bump**: each instructional-role event adds `+4` points (recency-weighted, same half-life), capped at `+15` total — exposure alone can raise mastery into "learning" but never "mastered".
3. **Idle decay**: the combined raw score decays toward 50% of itself with a 30-day half-life since the last event of any kind — a long-idle "mastered" KC drifts down into "review", never crashing to zero (retained knowledge doesn't vanish just because it's unexercised).
4. **Status**: `not-started` (zero events), `learning` (<40), `review` (40-79), `mastered` (>=80), read off the decayed number.

All constants live in `MASTERY_CONSTANTS` in that file.

---

## Notes for M2+ agents

- Astro pages call `src/lib/services/*` functions directly, server-side — **do not** `fetch()` your own API from `.astro` files or islands' server-side load code. Get `db` via `import { env } from 'cloudflare:workers'; const db = getDb(env.DB);` and `locals.user!.id`, exactly like the route handlers do.
- Svelte islands that need data client-side (after hydration, e.g. a form submit) **do** use `fetch('/api/v1/...')` — that's what the HTTP surface is for.
- Every service function signature is `(db: Db, userId: string, ...input) => Promise<result>`; ownership is checked inside the service (via `requireOwnedCourse`/`requireOwnedKc` in `src/lib/services/util.ts`) — never trust a client-supplied id without going through a service.
- Service outputs are Drizzle rows (camelCase, epoch-ms). Route handlers wrap the final `apiOk(...)` payload in `toApi(...)` from `src/lib/serialize.ts` to get the frozen snake_case/ISO shape — if you build a *new* route, wrap it the same way; if you consume services directly from a `.astro` page, you get raw camelCase back and can use it as-is (no need to call `toApi` outside the API boundary).
- `createEvent`/`updateEvent`/`deleteEvent` in `src/lib/services/events.ts` are the *only* place event rows are written — never `db.insert(events)` directly, or the KC mastery cache will go stale.

## TODO

- Detailed request/response examples for every field (partially done above; full JSON Schema generation from the Zod schemas would remove drift risk).
- Rate limiting strategy and headers.
- CORS policy for native clients.
- Versioning strategy for backward compatibility once this contract needs to change.
- Webhook signatures for agentic flow channels (Telegram, SMS callbacks) — M4+.
- `study_session`/`lecture` calendar item types (see Calendar deviation above).
- Adaptive difficulty within a tutor conversation; mode-switching mid-conversation; multi-turn lesson planning (see `docs/architecture/tutor.md`).
- `quick_quiz`'s `study_sessions.reflection`-as-JSON-blob storage is a v1 shortcut — a dedicated `quiz_items` table would be cleaner if quizzes grow more structure (partial credit, free-response, etc).
- OpenRouter live verification: local dev has no `OPENROUTER_API_KEY` set in `.dev.vars` as of this writing — tutor/flow tests mock the OpenRouter `fetch` call; a real key is needed to verify actual model behavior (prompt quality, model-spec emission rate) end-to-end.
