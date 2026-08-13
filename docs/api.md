# studyus API — FROZEN v1 (M1, 2026-08-11)

**Status**: FROZEN v1. This is the contract the iPad client (and any other native/agentic caller) builds against. Changes after this point are additive-only (new optional fields, new endpoints) unless a new major version is introduced. `tutor/*` and `flows/*` were reserved for M4 and are now implemented — see those sections below (the streaming message endpoint and the `end`/quick_quiz-answers endpoints return a non-`{data}` or additive shape respectively, called out where relevant).

**Base URL**: `/api/v1`

**Auth**: Session-based via HttpOnly cookie, name `studyus_session` (not `session_token` — corrected from the draft). Unauthenticated requests to any `/api/v1/*` route other than `/api/v1/auth/*` → `401 Unauthorized`.

> **v1.1 erratum**: the session cookie was renamed from `studybuddy_session` to `studyus_session` as part of the StudyBuddy→studyus app rename. This is a documented API change — clients checking the cookie name directly must update it.

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

**Client requirements (CSRF)**: Astro's built-in `checkOrigin` CSRF protection is on for this app (the default for `output: 'server'`). It compares the request's `Origin` header against the host on unsafe methods (`POST`/`PATCH`/`PUT`/`DELETE`). Browser same-origin requests (the webapp itself) are unaffected — the browser sets `Origin` automatically. **Non-browser clients** (a future iPad app, `curl`, integration tests, a Flue agent calling in over HTTP) **must send an `Origin` header matching the request's host** on unsafe methods, or the request is rejected before it reaches the route handler. Example: `curl -X POST http://localhost:4331/api/v1/events -H "Origin: http://localhost:4331" -H "Content-Type: application/json" -d '...'`.

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
**Errors**: `401 unauthorized` (wrong credentials), `400 invalid_input` (missing/malformed fields). Sets the `studyus_session` HttpOnly cookie.

### POST /auth/logout
**Response** (200): `{ "data": { "ok": true } }`

---

## User

### GET /user
**Response** (200):
```json
{ "data": { "id": "uuid", "email": "string", "name": "string|null", "current_term": "string|null", "onboarded_at": "iso|null" } }
```
`onboarded_at` is additive (M5) — set once by the onboarding stepper, `null` until then.

### PATCH /user
**Request**: `{ "name": "string?", "current_term": "string?", "onboarded": true? }`
`onboarded` is additive (M5), one-way — sending `true` stamps `onboarded_at` with the current time; there's no way to unset it (the onboarding page is skippable but not re-enterable).
**Response** (200): updated user object (same shape as GET).

---

## Courses

### GET /courses
**Query**: `include=mastery` (optional) — adds `mastery` (0-100, rollup average of the course's KC mastery caches) and `status` (`not-started|learning|review|mastered`) to each course. Without it, both fields are `null`.

**Response** (200): array of course objects — all `courses` table columns in snake_case, plus `mastery`/`status`. **Archived courses are excluded** by default (`listCourses` service defaults `includeArchived` to `false`); this route has no query param to opt back in — the one place that needs to see archived courses is the `/courses` page itself, which calls the service directly with `includeArchived: true` and renders them in a collapsed "Archived" section.

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
`GET` (list) items include `links: [{ course_id?, kc_id?, label? }]` — `label` is a display string resolved server-side (KC name if the link targets a KC, else course code). Added post-P3: the list previously omitted `links` entirely, which broke the notes page's SSR.

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

---

## v1.1 Additions (final)

**Status**: FROZEN as of P3. Every shape below has been exercised end-to-end against the running dev server (login, settings PATCH round-trip, course create/archive, notifications sweep idempotency + mark-read, notes with course links, tutor conversation list) in addition to the automated test suite (115 passing).

### User settings

`GET /user` and `PATCH /user` responses now include a resolved `settings` object (never partial — missing fields resolve to defaults):

```json
{ "data": { "...": "...", "settings": { "theme": "compass", "scheme": "system", "sidebar_collapsed": false } } }
```

`PATCH /user` accepts an optional `settings` object (any subset of the three fields) which **merges** onto the stored value — it is not a replace. Example: `PATCH /user { "settings": { "theme": "focus" } }` leaves `scheme`/`sidebar_collapsed` untouched.

- `theme`: `compass | focus | campus` (default `compass`)
- `scheme`: `light | dark | system` (default `system`)
- `sidebar_collapsed`: boolean (default `false`)

Resolution logic lives in `src/lib/services/user.ts::resolveSettings` / `DEFAULT_SETTINGS` — call it anywhere `users.settings` (raw JSON, possibly `{}` or missing fields) is read, both server-side (`.astro` SSR) and in the `GET`/`PATCH /user` routes.

### Notifications (P2A implements; schema only in P1)

Table `notifications` (migration `0001`): `id`, `user_id` (FK cascade), `type` (`assessment_due | task_overdue | kc_review | session_unfinished | grade_recorded`), `title`, `body?`, `course_id?` (FK set-null), `href`, `dedupe_key` (UNIQUE — sweep inserts are `ON CONFLICT DO NOTHING` keyed on this, e.g. `assessment_due:<id>`, `task_overdue:<id>:<dueDate>`), `read_at?`, `created_at`; indexed on `(user_id, read_at, created_at)`.

Frozen route shapes (P2A owns the implementation):

- `GET /notifications?unread=&limit=` → `{ data: { notifications: [...], unread_count: n } }` — runs the idempotent sweep first.
- `PATCH /notifications/:id/read` → marks one notification read.
- `POST /notifications/read-all` → marks all of the caller's unread notifications read.

### Courses — create/update

- `POST /courses` — strict body `{ code, title, term?, credits?, instructor?, overview?, color_hue? }`. Server derives `slug = slugify(code)` with `-2`/`-3` collision suffixing, and auto-creates one "General" branch (`sort_order: 0`) in the same `db.batch`.
- `PATCH /courses/:id` — same optional fields plus `archived`; **never** regenerates `slug`. Note the documented asymmetry: this lives in `[slug].ts` but treats the route param as an `id` for mutations (GET-by-slug, PATCH/DELETE-by-id).
- `color_hue`: integer 0-360, OKLCH hue. Stored in the existing `courses.color` column (as text). Convention: components set `style="--course-h: N"` from it; `tokens.css` derives `--course`/`--course-ink`/`--course-soft` from theme-owned `--course-l/-c` knobs, so the same hue reads correctly in every theme × scheme. Courses seeded before this column was populated, or created without `color_hue`, fall back client-side to a stable hash of the slug (`src/lib/courseHue.ts::hashHue` — the single canonical implementation; all consumers import it, no inline copies) — never `null`-render a course tint.
- `archived`: `listCourses(db, userId, opts)` defaults `includeArchived` to `false`, so an archived course drops out of the sidebar, dashboard, and every course picker (feed/notes/tasks/planner) automatically. The `/courses` index page is the one exception — it calls with `includeArchived: true` and renders archived courses in a collapsed `<details>` section below the active ones.

### Tutor conversations list

`GET /tutor/conversations?course=&kc=&limit=` → newest-first list with `kc_name` joined in. Powers the course Play tab (P2C).

### tasks.source

Additive column, `text` enum `user | system`, default `'user'`. Existing inserts are unaffected. `system` is reserved for future system-generated tasks (e.g. from the notifications sweep) — no generator exists yet.

### Shell contract (for P2 agents, not an HTTP shape but frozen here since other agents build against it)

- `AppShell.astro` exposes one named slot, `header-center`, forwarded into `Header.astro`'s `center` slot — pass course tabs / breadcrumbs / nothing there.
- `CustomEvent('open-add-course')` is dispatched on `window` by the sidebar's "+ Add course" button (`Sidebar.astro`, `#add-course-btn`) — P2D's AddCourseModal listens for it instead of the sidebar knowing about the modal.
- `localStorage` keys: `sb:theme`, `sb:scheme`, `sb:sidebar` (values `'expanded'|'collapsed'`) — written by `ThemeScript.astro` (read-only mirror) and by `AppearanceSettings.svelte` / the sidebar collapse toggle (read-write). SSR is the source of truth on load; localStorage only prevents a flash between a client-side settings change and the next full page load.
- `data-theme` (absent = compass), `data-scheme` (absent = system), `data-sidebar` (absent = expanded, `'collapsed'` otherwise) are the three `<html>` attributes the whole theme system keys off.
- `--course-h` is a plain CSS custom property, not a token — set it inline (`style="--course-h: 235"`) on any element that should render in a course's color; everything else (`--course`, `--course-ink`, `--course-soft`) derives from it via `tokens.css`.

---

## v1.2 Additions

**Status**: additive to the FROZEN v1 contract above. No existing field or endpoint shape changed; `assessment_due`/`task_due` calendar items gained new fields (backward compatible for any client ignoring unknown keys).

**Erratum to the v1.1 settings section**: the resolved default for `settings.scheme` is now `light` (was `system`) — a fresh user renders the light scheme regardless of OS preference; `system` remains a selectable value. The v1.1 example above showing `"scheme": "system"` reflects the old default.

### Calendar — new item types + shape

Migration `0002` adds `study_sessions.scheduled_at` (nullable integer, epoch ms) — a session may now be *planned* ahead of time, not just logged retroactively. This retires the M1 "Deviation from draft" note above: `study_session` calendar items are now implemented.

`GET /calendar` items now use the shared `CalendarItem` shape (`src/lib/types/calendar.ts`, frozen for other agents to build against):

```json
{
  "id": "uuid",
  "type": "assessment_due|task_due|study_session|event_logged",
  "title": "string",
  "date": "iso",
  "end_date": "iso|null",
  "all_day": true,
  "course_id": "uuid|null",
  "href": "string|null",
  "details": {}
}
```

- `assessment_due` / `task_due`: unchanged data, plus `end_date: null`, `all_day: true`, and `href` (`/courses/:slug#assessments` for assessments, `/tasks` for tasks). The task N+1 (one `task_courses` query per task) is fixed — one grouped `inArray` query covers every task in the window.
- `study_session` (new): windowed on `COALESCE(scheduled_at, started_at)`. `end_date` is `ended_at` if the session completed, else `started_at/scheduled_at + planned_minutes` (default 60). `title` is `"Study: <course code|General>"`, `href: "/planner"`. `details`: `{ intended_event_type, planned_minutes, started_at, ended_at, scheduled_at, completed }`.
- `event_logged` (new): windowed on `events.ts`. `title` is the humanized event type (e.g. `lecture_attended` → `"Lecture attended"`), suffixed with `" · <kc name>"` when the event has a KC. `href` is `/courses/:slug/concepts` when a KC is attached, else `/planner`. `details`: `{ event_type, kc_id, kc_name, is_instructional, is_assessment, source }`.

`course_id` (query param) filters all four item sources, matching the existing single-course-scoping behavior.

### Events — from/to window + kc_name

`GET /events` gains optional `from`/`to` (ISO datetimes, parsed like the calendar query) filtering on `ts`. Each returned event row now also includes `kc_name` (joined from `kcs`, `null` when the event has no `kc_id`) alongside the existing fields — additive.

### Events — types filter

`GET /events` gains an optional `types` query param: a comma-separated list of event types (e.g. `types=lecture_attended,lecture_missed`) to restrict results to, applied via `IN` alongside the existing `course`/`kc`/`from`/`to` filters. Combine with `limit` (still defaults to 20, max 200) to fetch a complete, correctly-scoped window for a specific event kind (e.g. all attendance events for a course) instead of relying on a large generic `limit` and filtering client-side, which risks truncating the set when other event types crowd the window.

### Study sessions — scheduling

`POST /sessions` accepts an optional `scheduled_at` (ISO). When present the session is a *planned* session: `started_at` is stamped with the same value (the column stays `NOT NULL`), so an unstarted planned session still sorts/filters correctly wherever `started_at` is read. `PATCH /sessions/:id/complete` accepts an optional `scheduled_at` too, to reschedule a still-planned session in the same call that completes or edits it. `GET /sessions` gains optional `from`/`to`, windowed on `COALESCE(scheduled_at, started_at)` (same convention as the calendar).

### Seed demo data

`scripts/seed.ts` now seeds a deterministic, idempotent demo data block (re-running the seed refreshes dates rather than duplicating rows) for the user's **current-term** courses only (`users.current_term`, set to `"Winter 2025"` by the seed script — the courses in `courses/courses.json` whose `term` string includes that value): 3 assessments per course (one past-due and graded, one due soon, one due later), 6 tasks total (one overdue, several upcoming, two linked to courses), ~12 logged events across courses/KCs over the past two weeks, and 5 study sessions (3 completed in the past week, 2 scheduled in the next week via `scheduled_at`) — enough for the planner/dashboard week views to render something realistic out of the box.

### Class sessions (v1.3)

**Attendance re-model**: class sessions are pre-existing scheduled rows whose *status* gets updated, not events appended by a button click. `events` (`lecture_attended`/`lecture_missed`) remains a valid way to log a lecture retroactively for mastery-fold purposes, but **the events API is no longer the attendance mechanism** — StandingTab's old event-buttons flow is replaced by the UI agent's class-session list/toggle UI against the endpoints below.

Migration `0003` adds:
- Table `class_sessions`: `id`, `user_id` (FK cascade), `course_id` (FK cascade), `date` (epoch ms at **local noon** of the class day — noon avoids a TZ day-shift when converting to/from ISO), `status` (`attended | missed`, nullable — `null` means unmarked), `note` (nullable), `source` (`schedule | manual | seed`, default `schedule`), `created_at`. `UNIQUE(course_id, date)`.
- `courses.meeting_days` — nullable JSON array of ISO weekday numbers (Mon=1..Sun=7), e.g. `"[1,3,5]"`. `null` means the course has no fixed meeting schedule.

Frozen route shapes:

- `GET /courses/:id/class-sessions?from=&to=&limit=` → `{ data: [{ id, course_id, date, status, note, source, created_at }, ...] }`, sorted `date` DESC (`from`/`to` are ISO datetimes, `limit` defaults to 100, max 200). **Runs the idempotent generation sweep first** (same pattern as the notifications sweep, `src/lib/services/notifications.ts`): if the course has `meeting_days`, `INSERT OR IGNORE` one row per matching weekday from 70 days back through today inclusive (never future), keyed idempotent on `UNIQUE(course_id, date)`. One-time backfill: a freshly generated row's initial status is seeded from any `lecture_attended`/`lecture_missed` event the user logged for that course on the same local day (`lecture_attended` wins if both exist that day) — after generation, status only changes via the PATCH below, never by the sweep re-running.
- `PATCH /class-sessions/:id` — body `{ status: "attended" | "missed" | null }` → updated row. Ownership enforced in the service (cross-user id → `404 not_found`).
- `POST /courses/:id/class-sessions` — body `{ date: ISO }` → creates a `source: "manual"` session, `date` normalized to local noon. A collision with an existing session on the same course + date → `409` with error code `invalid_input`.
- `PATCH /courses/:id` gains optional `meeting_days: number[] | null` — validated to weekday values 1-7, deduped, and sorted before storage. `GET /courses/:slug` and `listCourses` (`GET /courses`) both now include `meeting_days` as the parsed array (or `null`), not the raw JSON string.

**Serializer fix**: `class_sessions.date` was initially skipping the epoch-ms → ISO conversion that every other date-shaped field gets, because `toApi`'s automatic camelCase→snake_case key match only recognized `_at`/`_date` suffixes (plus an explicit `ts` exception) — a bare `date` key didn't match either. `src/lib/serialize.ts` now special-cases `date` the same way as `ts`. `class_sessions.date` in `GET /courses/:id/class-sessions` responses is an ISO string, per the original contract above (not a raw epoch-ms integer).

### Assessments — official vs. practice split (v1.3.1)

Scope addition: separate official assessments (count toward the weighted grade) from practice ones (never do, even when graded) — plus a practice-progress readout for course home.

Migration `0004` adds `assessments.kind` — `text`, enum `official | practice`, `NOT NULL DEFAULT 'official'`. Existing rows are unaffected (all default to `official`).

- `POST /courses/:id/assessments` gains optional `kind: "official" | "practice"` (default `official`).
- `PATCH /assessments/:id` gains optional `kind`.
- Every assessment shape returned by the API (`GET /courses/:id/assessments`, `GET /grades/summary`'s `by_course[].assessments`) now includes `kind`.
- **Weighted standing counts official assessments only**: `getGradesSummary`'s per-course and credit-weighted overall calculation (`weighted_grade`, `overall_weighted_grade`) filters to `kind: 'official'` before doing anything else — a graded `practice` assessment, even one carrying a `weight_pct`, never moves either number. The dashboard's course-card "N of M assessments done" readout (`src/pages/dashboard.astro`) is likewise scoped to `kind: 'official'` — practice assessments have their own progress readout below, not this one.
- `GET /courses/:id/practice-summary` (new, additive) → `{ data: { practice_events_30d, distinct_kcs_practiced, total_kcs, last_practiced_at, practice_assessments_done, practice_assessments_total } }`. `practice_events_30d` counts events of type `practice_done | retrieval_practice | quiz_taken | tutor_session` for the course in the trailing 30 days; `distinct_kcs_practiced` is the distinct `kc_id` count across the *same* event types but **all-time** (not windowed); `total_kcs` is the course's KC count; `last_practiced_at` is the most recent such event's timestamp (ISO, or `null` if none); `practice_assessments_done`/`practice_assessments_total` count `kind: 'practice'` assessments for the course, "done" meaning `grade_received` is set.
- Seed: each current-term demo course gains two `kind: 'practice'` assessments ("Practice midterm", graded; "Problem-set self-check", ungraded) alongside its existing three official ones — confirmed the seeded official-only weighted grades are unchanged by their presence.

---

## v1.4 Additions — Task-centric platform (contract freeze)

**Status**: wire shapes only, frozen ahead of the rest of the build so parallel tracks can develop against them. Generator policies (which family produces what, on what schedule, keyed how) and other behavior notes are completed in the docs pass — see the note at the end of this section.

Migration `0005` adds to `tasks`: `description` (text, nullable), `type` (text enum — see below — `NOT NULL DEFAULT 'todo'`), `parent_task_id` (self-FK, cascade delete), `completed_at` (integer epoch ms, nullable), `dismissed_at` (integer epoch ms, nullable — system-task soft delete), `course_id` / `class_session_id` / `assessment_id` / `kc_id` (nullable FKs, cascade delete — origin of a sweep-generated task), `dedupe_key` (text, nullable, unique-indexed). It also adds a `UNIQUE(task_id, course_id)` index to `task_courses` (backs the idempotent origin-course link backfill the sweep performs). `dismissed_at` and `dedupe_key` are internal-only and **never appear in any serialized task response.**

### Task object — extended shape

Every task returned by the API (`GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`) now includes:

```json
{
  "id": "uuid",
  "title": "string",
  "description": "string|null",
  "type": "todo|attend_class|prep_before_class|review_after_class|practice_kc|stale_kc|grade_entry",
  "due_date": "iso|null",
  "completed": true,
  "completed_at": "iso|null",
  "parent_task_id": "uuid|null",
  "course_id": "uuid|null",
  "class_session_id": "uuid|null",
  "assessment_id": "uuid|null",
  "kc_id": "uuid|null",
  "source": "user|system",
  "courses": [{ "id": "uuid", "code": "string" }]
}
```

`completed` remains the API's completion field (still maps to the `done` column) — unchanged. `type` is server-derived, not client-settable: `POST /tasks` and `PATCH /tasks/:id` accept no `type` field, so every task a user creates directly is `'todo'`; the other six values are only ever written by the sweep (`services/taskSweep.ts`).

### `POST /tasks` — subtasks

`POST /tasks` accepts an optional `parent_task_id` (must reference a task owned by the caller). Nesting is capped at one level: if the referenced parent itself has a non-null `parent_task_id`, the request fails with `409 Conflict` (`error.code: "conflict"`, message "Subtasks cannot be nested"). `parent_task_id` is create-only — there is no re-parenting via `PATCH`.

### `DELETE /tasks/:id` — dismissal semantics for system tasks

Deleting a task with `source: "user"` is a hard delete, cascading to its children. Deleting a task with `source: "system"` instead stamps `dismissed_at` (soft delete) and hard-deletes its children; the row — and its `dedupe_key` — survives so the generating sweep can never resurrect it. Dismissed tasks are excluded from every list and calendar response.

### Settings — `task_generators`

`settings` (read via `GET /api/v1/user`, written via `PATCH /api/v1/user`) gains a nested `task_generators` object, one boolean per generator family:

```json
{
  "task_generators": {
    "attend_class": true,
    "prep_before_class": false,
    "review_after_class": true,
    "practice_kc": true,
    "stale_kc": false,
    "grade_entry": true
  }
}
```

All six keys are optional on input and always present on read (a missing key resolves to the default shown above). A `PATCH` touching one key merges onto the stored object key-wise — it does not clobber sibling toggles.

### Assessments — `kc_ids`

`POST /courses/:id/assessments`, `PATCH /assessments/:id`, and every assessment list/summary shape (`GET /courses/:id/assessments`, `GET /grades/summary`'s `by_course[].assessments`) gain `kc_ids: string[]` — the KC ids linked via `assessment_kcs`. On `PATCH`, `kc_ids` **replaces** the full link set (not additive); an empty array clears all links. An id that doesn't belong to the assessment's course fails the request with `404 Not Found`.

### Calendar — `task_due` details additions

`task_due` calendar items' `details` (opaque per the frozen `CalendarItem` shape) gain `task_type`, `parent_task_id`, `class_session_id`, and `completed_at` — additive, backward compatible for any client ignoring unknown keys.

**Note**: Generator policies and behavior notes completed in the docs pass.
