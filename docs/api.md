# studyus API — v1 contract (M1 baseline + additive revisions)

**Status**: The M1 resource shapes are the v1 compatibility baseline and later product capabilities are documented additively below. Authentication is the one deliberate breaking migration: Clerk superseded the hand-rolled session endpoints. A native/iPad client must use a documented Clerk token strategy before treating this as a complete native-client contract. `tutor/*` and `flows/*` were reserved for M4 and are implemented.

**Base URL**: `/api/v1`

**Auth**: Clerk is the authentication authority. Browser requests carry Clerk's session; `src/middleware.ts` verifies it, resolves the Clerk identity to immutable local `users.id`, and exposes that local learner row to every route. Unauthenticated `/api/v1/*` requests return `401 Unauthorized`. The legacy `studyus_session` cookie and D1 login/logout flow are retired.

**Envelope** (unchanged from draft):
```json
{ "data": { /* response body */ } }
```
or on error:
```json
{ "error": { "code": "invalid_input", "message": "..." } }
```
Error `code`s in use: `invalid_input` (400, includes Zod validation failures), `idempotency_conflict` (409 — see Events below), `unauthorized` (401), `forbidden` (403), `not_manual_event` (400 — see Events below), `not_found` (404), `internal_error` (500), `conversation_capped` (400 — see AI Tutor below), `quiz_generation_failed` (502 — see Agentic Flows below), `quiz_not_gradable` (400 — see Agentic Flows below).

**IDs**: All entity ids are UUID-*shaped* strings (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, lowercase hex) but are **not guaranteed to be valid RFC4122 v4 UUIDs** — seed data uses deterministic UUID-shaped hashes (stable across reseeds) that don't set the version/variant nibits real UUIDs do. Clients must treat ids as opaque strings matching that grouping, not validate strict UUID version.

**Timestamps**: Every response field ending in `_at`/`_date`, plus `ts`, is an ISO 8601 datetime string. Internally these are stored as epoch-ms integers and converted at the API boundary (`src/lib/serialize.ts::toApi`) — this is the one place that conversion happens, so it's always applied.

**Client requirements (CSRF)**: Astro's built-in `checkOrigin` CSRF protection is on for this app (the default for `output: 'server'`). It compares the request's `Origin` header against the host on unsafe methods (`POST`/`PATCH`/`PUT`/`DELETE`). Browser same-origin requests (the webapp itself) are unaffected — the browser sets `Origin` automatically. **Non-browser clients** (a future iPad app, `curl`, integration tests, a Flue agent calling in over HTTP) **must send an `Origin` header matching the request's host** on unsafe methods, or the request is rejected before it reaches the route handler. Example: `curl -X POST http://localhost:4331/api/v1/events -H "Origin: http://localhost:4331" -H "Content-Type: application/json" -d '...'`.

---

## Authentication

### Clerk routes

- `/sign-in` — Clerk `SignIn` component.
- `/sign-up` — Clerk `SignUp` component.
- `/account` — Clerk `UserProfile` component.

These are page routes, not JSON authentication endpoints. `POST /auth/login` and `POST /auth/logout` are retained only as explicit retirement responses and return `410 auth_retired`; they must not mint or clear a D1 session. See `docs/architecture/authentication.md` for the identity bridge and legacy-account migration.

---

## User

### GET /user
**Response** (200):
```json
{ "data": { "id": "uuid", "email": "string", "name": "string|null", "current_term": "string|null", "onboarded_at": "iso|null" } }
```
`onboarded_at` is set only when the learner has an active, non-archived course with at least one meaningful KC. Middleware enforces that invariant for authenticated product pages.

### PATCH /user
**Request**: `{ "name": "string?", "current_term": "string?", "onboarded": true? }`
`onboarded` remains a compatibility input. Sending `true` first verifies the same usable-course invariant and returns `409` when it is not satisfied; it cannot bypass onboarding.
**Response** (200): updated user object (same shape as GET).

---

## Onboarding

### GET /onboarding

Returns the server-evaluated completion state, usable-course flag, learner
institution/program/preferences, and current dated academic term. `complete` is
true only when `onboarded_at` and the meaningful-KC invariant both hold.

### POST /onboarding/import-demo

Accepts the strict version-1 browser draft subset: `draft_id`, optional learner
context, learning preferences, up to five `CourseSetupProposal` objects, and
bounded structural `review_metrics` counts (`renamed`, `reordered`, `excluded`).
Proposals marked `source.kind = simulated` are ignored. A single idempotent D1
batch creates the real term/course content and returns
`{ complete, course_id, course_slug, imported }`; repeated learner/draft pairs
return the existing result with `imported: false`. That replay also covers two
submits racing each other: both can pass the idempotency read before either
commits, and because the batch is atomic the loser wrote nothing, so it returns
the winner's result rather than the unique-constraint 500 it used to.

`course_slug` is `slugify(code)` scoped to the learner (`chee-314`), so two
learners importing the same course share a URL.

Reviewed template proposals include stable branch/KC references, inclusion and
ordering choices, prerequisite summaries, and assessment date decisions. The
server re-resolves the authored template, enforces selected prerequisites and
in-term confirmed dates, then clones its graph, scaffolds, misconceptions,
exercise bank, resources, and assessments. Rich authored answers and teaching
bodies are not accepted from the browser.

### GET /onboarding/templates?q=&level=&limit=

Searches browser-safe metadata for the course catalog: the authored reviewed
templates plus the generated McGill catalogue outlines. Matches on code, title,
subject, department, faculty, aliases, and **concept names**, so a learner can
find a course by what it covers rather than only by its code.

`q` is capped at 100 characters, `level` is `undergraduate` or `graduate`, and
`limit` is clamped to 1..100 (default 50). Response:
`{ "data": { "courses": [...], "total": n, "truncated": boolean } }` — `total`
counts every match, not just the returned window, so clients report an honest
count. Searching happens server-side; clients must not re-filter the results,
which are already ranked.

### GET /onboarding/templates/:id

Returns the editable course-map and assessment summary used by onboarding. It
does not return exercise answers, scaffold bodies, or misconception corrections.

### POST /api/public/demo-events

Public, outside the `/api/v1` base. Accepts at most 20 strict allow-listed
funnel events per request. Existing clients may continue to send only `events`;
analytics-aware clients may additionally send top-level UUIDs `anonymous_id`
and `app_session_id`. It stores structural fields only, ignores timestamps
outside seven days, deduplicates event UUIDs, and caps a browser session at 100
accepted events. Only rows actually inserted are mirror-forwarded once to
PostHog `/batch/`; replays and historical rows are never mirrored. DNT suppresses
the request client-side and is also honored at the route boundary. Arbitrary
values such as institution, course title, filename, or document text are
rejected by the strict schema.

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
| quiz_taken, assignment_graded, exam_graded, self_assessment, placement_probe, diagnostic_probe | false | true |
| practice_done, retrieval_practice, tutor_session | true | true |
| correction_accepted, course_added | false | false |

### POST /events
**Request**:
```json
{ "type": "<one of the 16 types above>", "kc_id": "uuid?", "course_id": "uuid?", "ts": "iso?", "payload": {}? }
```
`is_instructional`/`is_assessment` are **always derived server-side from `type`** — they are not client-settable (this differs from the draft's request shape, which listed them as request fields; they're response-only). `source` is always `"manual"` for events created through this endpoint.

Maintained clients send an optional UUID-shaped `Idempotency-Key` header. The first
use creates the event and returns `201`. Repeating the same normalized request under
the same learner and key returns the current event with `200`,
`Idempotency-Replayed: true`, and `mastery_deltas: []`; it never re-folds mastery.
Object-key order and equivalent ISO offsets do not change request identity. Changing
the type, KC, course, explicit timestamp, or payload while reusing a key returns
`409 idempotency_conflict`. Keys are tenant-scoped. Deleting the event leaves a
ledger tombstone, so a late retry conflicts instead of recreating deleted evidence.
Omitting the header remains accepted for v1 clients but has no retry guarantee.

**Response** (201 first creation; 200 replay): `{ ...event, "mastery_deltas": [...] }`.
For a first creation, `mastery_deltas` has zero or one entries — one iff `kc_id` was
provided (each event has at most one KC). Replays always return an empty array.

### GET /events
**Query**: `course=uuid?`, `kc=uuid?`, `limit` (default 20, max 200). Response: array of event objects, newest first.

### PATCH /events/:id
**Manual-source only.** Attempting to PATCH a `session`/`tutor`/`seed`/`system`-sourced event returns `400 not_manual_event`. Changing `type` re-derives the role flags. Response: `{ ...event, mastery_deltas }`.

### DELETE /events/:id
Allowed for **any** source (system-generated events are delete-only, per the plan — the confirmation step is a client UX concern, not server-enforced). Response: `{ "data": { "mastery_deltas": [...] } }`.

### Domain event vocabulary narrowing (2026-08-28)

This is a ratified v1 narrowing rather than an additive revision. Product-usage
telemetry is no longer accepted by `POST /events`: `recommendation_followed` and
`recommendation_ignored` moved to the separate behavioral vocabulary and are captured
deliberately by the dashboard's Next Move card. The 11 never-emitted placeholders
`task_completed`, `task_dismissed`, `correction_dismissed`, `course_archived`,
`plan_committed`, `session_scheduled`, `session_rescheduled`, `settings_changed`,
`coach_session`, `reflection_captured`, and `digest_sent` were removed rather than
promising an activity stream this API does not own. Production D1 contained zero
rows for all 13 retired names at the time of the change, so no backfill or legacy-row
migration was required. Posting or filtering by one of these names now returns 400.

---

## Calendar & Grades

### GET /calendar
**Query**: `from`, `to` (both required ISO datetimes), `course=uuid?`.

The current unified calendar emits five item types: assessment deadlines, task deadlines, scheduled study sessions, logged events, and timed class sessions. `getCalendar` is the sole producer. A timed class session suppresses its linked `attend_class` task item so the meeting renders once.

```json
{ "data": [{ "id": "uuid", "type": "assessment_due|task_due|study_session|event_logged|class_session", "title": "string", "date": "iso", "end_date": "iso|null", "all_day": "boolean", "course_id": "uuid|null", "href": "string|null", "details": {} }] }
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

`POST` body's optional `course_ids` (and `PATCH`'s replace-set, below) are ownership-checked before any write happens: every id must belong to the caller, or the whole request fails with `404 Not Found` — a request naming another user's course id can't link a task to it (`requireOwnedCourses` in `services/tasks.ts`).

### PATCH|DELETE /tasks/:id
`PATCH` body accepts `title?`, `description?`, `due_date?`, `completed?`, `course_ids?` (replaces the full set of linked courses when provided — ownership-checked the same way as `POST`, and verified *before* the existing link set is torn down, so a foreign id 404s without leaving the task's links half-updated).

---

## Notes

### GET|POST /notes
Matches draft (`content` maps to the internal `body` column name). `POST` body: `{ title, content, links?: [{ course_id?, kc_id? }] }`.
`GET` (list) items include `links: [{ course_id?, kc_id?, label? }]` — `label` is a display string resolved server-side (KC name if the link targets a KC, else course code). Added post-P3: the list previously omitted `links` entirely, which broke the notes page's SSR.

Every `course_id`/`kc_id` in `links` is ownership-checked before the note (or its link set) is written: a foreign id fails the whole request with `404 Not Found`, both on create and on `PATCH`'s link replacement (`requireLinksOwned` in `services/notes.ts`) — validated before any mutation, so a rejected request never leaves an orphaned note or a wiped link set behind.

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

**Size cap** (landed 2026-08-15): files over `MAX_ATTACHMENT_BYTES` (10 MB, `src/lib/schemas/attachments.ts`) are rejected with `400 invalid_input` — checked against `file.size` before the upload is ever buffered into memory, so an oversized file never reaches R2. There is no MIME allow/deny list; any content type is accepted.

### GET|DELETE /attachments/:id
Matches draft. `GET` streams the object body with the stored `Content-Type` and a `Content-Disposition: inline` header.

---

## Study Sessions

### GET|POST /sessions
`intended_event_type` is constrained to the domain event vocabulary. `POST` validates,
deduplicates, and atomically inserts optional `kc_ids`; a course-scoped session only
accepts active caller-owned KCs from that course. `GET` adds
`disposition: null|"completed"|"discarded"`.

### PATCH /sessions/:id/complete
Canonical body:
```json
{
  "ended_at": "ISO?",
  "reflection": "string?",
  "scheduled_at": "ISO?",
  "kc_outcomes": [{ "kc_id": "uuid", "self_rating": "integer 1-5?" }]
}
```
Legacy `kc_ids_touched: uuid[]` remains accepted but is mutually exclusive with
`kc_outcomes`. An explicitly present empty array means zero events; only omission of
both fields falls back to `session_kcs`. The terminal ledger, session update, missing
KC links, event appends, and one mastery recompute per KC commit in one D1 batch.
Assessment-capable intended events carry `self_rating` directly; a rated
instructional-only event gets an atomic `self_assessment` companion.

Response remains additive:
`{ id, disposition:"completed", ended_at, events_appended, mastery_deltas, already_finalized }`.
A same-terminal retry returns the canonical events with empty deltas and
`already_finalized:true`; a prior discard returns 409.

### PATCH /sessions/:id/discard
Strict body `{ ended_at?: ISO }`. Records `disposition:"discarded"` and never appends
evidence, even when the session has stored KC links. Same-terminal retries are 200
and idempotent; completion-after-discard/discard-after-completion returns 409.
Quick-quiz sentinel rows reject both ordinary terminal routes and remain owned by
the quiz grading endpoint.

---

## AI Tutor (M4)

Server-side OpenRouter integration (`src/lib/services/tutor/{openrouter,prompts,modelSpec,conversations}.ts`). Mode is derived from the KC's `kc_type` per the KLI mapping in `docs/architecture/events-and-mastery.md` (`fact`/`association`→`recall`, `concept`→`classify`, `rule`→`worked_example`, `principle`→`interactive_model` by default, with `self_explain` available as an explicit override) unless the client passes `mode` explicitly at creation.

### GET /capabilities

Returns the browser-safe runtime gate without exposing a key: `{ "data": { "ai": { "enabled": boolean, "provider": "openrouter", "reason": "disabled"|"provider_not_configured"|null, "features": { "tutor": boolean, "quiz_generation": boolean } } } }`. AI is available only when `AI_FEATURES_ENABLED=true` and a non-blank `OPENROUTER_API_KEY` secret are both present. This response is a UI projection; tutor creation/message endpoints and quiz generation enforce the same gate server-side. A gated AI request returns `503 { "error": { "code": "ai_unavailable", "message": "..." } }`.

### POST /tutor/conversations
**Request**: `{ "kc_id": "uuid", "mode": "recall|classify|worked_example|self_explain|interactive_model"? }`

**Response** (201): the created Durable Object conversation summary (`id`, `kc_id`, `mode`, `details`, `status`, `active_turn_id`, `created_at`, `ended_at`).

### GET /tutor/conversations/:id
**Response** (200): `{ ...conversation, "messages": [{ id, conversation_id, role, content, created_at }] }`, messages oldest-first. The conversation includes `status`, `active_turn_id`, and `ended_at`; clients must reconcile these server values after a stream or close rather than treating optimistic browser state as durable.

### POST /tutor/conversations/:id/messages
**Request**: `{ "content": "string" }`. **Response**: `text/event-stream`, not the `{data}` envelope — each frame is `data: {"delta":"..."}\n\n`, terminated by `data: {"done":true}\n\n`. The user message is persisted immediately; the assistant's full reply is persisted once the stream completes.

Per-conversation message cap: **30** (`MAX_MESSAGES_PER_CONVERSATION` in `conversations.ts`), user+assistant combined. Once an exchange would reach the cap, the conversation is auto-ended (see below) after that reply streams. Posting to an already-capped conversation returns `400 conversation_capped` instead of a stream.

### POST /tutor/conversations/:id/end — additive, beyond the original plan draft
**Request**: `{ "final_rating": 1-5? }`. Appends one dual-role `tutor_session` event (`payload: { conversation_id, mode, final_rating? }`) via the events service and returns `{ conversation, event, mastery_deltas }`. Also fired automatically when the message cap is reached — the client button just exposes the same action. Not idempotency-guarded: calling it twice appends two events (each representing a distinct self-assessment/close), same as the `tutor_session` events a Flue channel agent would append per session-close.

### GET /runtime/snapshot

Authenticated, browser-safe projection of the caller's per-learner Durable Object. Returns `{ active_conversations, sessions, next_alarm_at }`. `active_conversations` is the complete ordered set, not a singular “current” conversation, because separate tabs or future channels may legitimately have concurrent sessions. The local learner ID and Durable Object identity are never exposed, and conversations whose KCs are no longer caller-owned are filtered out. Browser Nanostores use this endpoint for focus/page-show revalidation; it is a projection, not a second source of truth.

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

Quick Quiz is not itself an AI feature. Seeded MCQ bank items work while AI is disabled. Only an uncovered selected KC invokes the `quiz_generation` capability; if that capability is unavailable, creation fails with `503 ai_unavailable` before an OpenRouter call or quiz-session write.

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
- OpenRouter live verification remains environment-specific. Automated tests use a fake credential and mocked provider responses; never copy a deployment secret into test fixtures.

---

## v1.1 Additions (final)

**Status**: FROZEN as of P3. Every shape below has been exercised end-to-end against the running dev server (login, settings PATCH round-trip, course create/archive, notifications sweep idempotency + mark-read, notes with course links, tutor conversation list) in addition to the automated test suite (371 passing, as of v1.6 — see "v1.6 Additions" below).

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
- `GET /notifications/count` (additive, post-v1.4) → `{ data: { unread: <int> } }` — a single `count(*)` aggregate for a header badge. **Deliberately does not run the sweep** (unlike the three routes above) — it's side-effect-free by design, so polling it on an interval never mints new notification rows as a side effect. See `src/pages/api/v1/notifications/count.ts`.

### Courses — create/update

- `POST /courses` — strict body `{ code, title, term?, credits?, instructor?, overview?, color_hue? }`. Server derives `slug = slugify(code)` with `-2`/`-3` collision suffixing **scoped to the learner** (`courses_user_slug_unique`), so another account holding the same course code never changes your slug; and auto-creates one "General" branch (`sort_order: 0`) in the same `db.batch`.
- `PATCH /courses/:id` — same optional fields plus `archived`; **never** regenerates `slug`. Note the documented asymmetry: this lives in `[slug].ts` but treats the route param as an `id` for mutations (GET-by-slug, PATCH/DELETE-by-id).
- `color_hue`: integer 0-360, OKLCH hue. Stored in the existing `courses.color` column (as text). Convention: components set `style="--course-h: N"` from it; `tokens.css` derives `--course`/`--course-ink`/`--course-soft` from theme-owned `--course-l/-c` knobs, so the same hue reads correctly in every theme × scheme. Courses seeded before this column was populated, or created without `color_hue`, fall back client-side to a stable hash of the slug (`src/lib/courseHue.ts::hashHue` — the single canonical implementation; all consumers import it, no inline copies) — never `null`-render a course tint.
- `archived`: `listCourses(db, userId, opts)` defaults `includeArchived` to `false`, so an archived course drops out of the sidebar, dashboard, and every course picker (feed/notes/tasks/planner) automatically. The `/courses` index page is the one exception — it calls with `includeArchived: true` and renders archived courses in a collapsed `<details>` section below the active ones.

### Tutor conversations list

`GET /tutor/conversations?course=&kc=&limit=` → newest-first list with `kc_name`, `status`, `active_turn_id`, and `ended_at` joined in. Powers the course Play tab (P2C), whose history links include `?c=<conversation_id>` so they reopen the selected DO conversation instead of starting a replacement.

### tasks.source

Additive column, `text` enum `user | system`, default `'user'`. Existing inserts are unaffected. At the time of this note, `system` was reserved for future system-generated tasks (e.g. from the notifications sweep) with no generator yet. **Superseded by v1.4 (below)**: `services/taskSweep.ts` now implements that generator (six independently-toggleable families) and populates this column.

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

**Status**: COMPLETE. Wire shapes (frozen ahead of the rest of the build so parallel tracks could develop against them) plus every generator policy and behavior note, filled in below once the corresponding service code landed.

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

`POST /tasks` accepts an optional `parent_task_id` (must reference a task owned by the caller). Nesting is capped at one level: if the referenced parent itself has a non-null `parent_task_id`, the request fails with `409` and `error.code: "invalid_input"` (the same reused code as the class-sessions date-collision 409 documented above — there is no separate `conflict` code in the "Error codes in use" list at the top of this doc), message "Subtasks cannot be nested". `parent_task_id` is create-only — there is no re-parenting via `PATCH`.

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

`POST /courses/:id/assessments`, `PATCH /assessments/:id`, and `GET /courses/:id/assessments` gain `kc_ids: string[]` — the KC ids linked via `assessment_kcs`. On `PATCH`, `kc_ids` **replaces** the full link set (not additive); an empty array clears all links. An id that doesn't belong to the assessment's course fails the request with `404 Not Found` — enforced on both `POST` (create-time linking) and the `PATCH` replace path.

**Scope note**: `GET /grades/summary`'s `by_course[].assessments` does **not** gain `kc_ids`. `services/grades.ts` builds that array by hand as a separate, grade-math-focused shape (`assessment_id`, `title`, `type`, `weight_pct`, `grade_received`, `grade_max`, `kind`) and has no consumer that needs the KC links, so it was deliberately left out rather than plumbed through for symmetry with the assessments endpoints above.

### Calendar — `task_due` details additions

`task_due` calendar items' `details` (opaque per the frozen `CalendarItem` shape) gain `task_type`, `parent_task_id`, `class_session_id`, and `completed_at` — additive, backward compatible for any client ignoring unknown keys. `GET /calendar` runs the sweep (below) before querying, same as `GET /tasks` — a calendar window can surface sweep-generated tasks that no prior task list call has triggered yet.

### The sweep — generator families and policy

Idempotent generator (`services/taskSweep.ts`), same idiom as `sweepNotifications`/`sweepClassSessions`: read `settings.task_generators`, short-circuit to a no-op if every family is off, run the enabled families' collectors in parallel, `db.batch` the candidate rows with `INSERT ... ON CONFLICT(dedupe_key) DO NOTHING`, backfill `task_courses` links for any newly-surviving system task that has a `course_id` (a **second pass** — a dedupe conflict on the insert doesn't report which row survived, so the sweep can't know which task to link in the same batch as the insert), then purge tasks dismissed more than 120 days ago. Invoked at the top of `listTasks` and `getCalendar` only — there is no dedicated sweep endpoint.

All six families default from `DEFAULT_SETTINGS.task_generators` (`services/user.ts`) — see the Settings section above for the exact defaults and merge semantics.

| family | trigger / window | caps | `due_date` | dedupe key |
|---|---|---|---|---|
| `attend_class` | class sessions within ±7d of today, skipping archived courses; a session already `attended` produces a pre-completed task | — | session date | `attend_class:<class_session_id>` |
| `prep_before_class` | course's `meeting_days`, the next class day in (today, today+2d] (there's no future `class_sessions` row to read a date off of instead) | — | class day − 1d | `prep_before_class:<course_id>:<yyyymmdd of class day>` |
| `review_after_class` | class sessions with `status: "attended"` and date ≥ today − 3d | — | session date + 1d | `review_after_class:<class_session_id>` |
| `practice_kc` | official, ungraded assessments due in (now, now+7d], joined to `assessment_kcs` with `mastery < 80` | 5 KCs per assessment, lowest mastery first | assessment due date − 1d | `practice_kc:<assessment_id>:<kc_id>` |
| `stale_kc` | KCs with `mastery > 0` and `last_event_at` older than 7d | 3 per sweep, 1 per course, lowest mastery first | `null` — deliberately undated ("anytime"), so this family never joins the overdue treadmill or shows up on the calendar | `stale_kc:<kc_id>:<last_event_at ?? 0>` (re-keys each time the KC goes idle again, same idiom as the `kc_review` notification's dedupe key) |
| `grade_entry` | official, ungraded assessments due in [now−14d, now) | — | due date + 3d | `grade_entry:<assessment_id>` |

Every collector also skips archived courses. Generated titles: `Attend <course code>`, `Prep for <course code>`, `Review notes: <course code>`, `Practice <kc name> for <assessment title>`, `Revisit <kc name>`, `Enter grade: <assessment title>`.

Every sweep-generated task also carries a non-null, human-readable `description` (the `description` field is never left `null` for a `system`-sourced row) — one per family: `attend_class` → `"Class session — <course code>"`, `prep_before_class` → `"Get ready for <course code>'s upcoming class"`, `review_after_class` → `"Review your notes from <course code>'s class"`, `practice_kc` → `"<kc name> is linked to <assessment title>"`, `stale_kc` → `"<kc name> hasn't been practiced recently"`, `grade_entry` → `"Enter your grade for <assessment title>"`.

### Two-way sync

- **`attend_class` ↔ class session**: `PATCH /class-sessions/:id` (`{status}`) syncs the linked `attend_class` task — `attended` → task marked done, `completed_at` stamped; `missed`/`null` → task reopened, `completed_at` cleared. In the other direction, `PATCH /tasks/:id` (`{completed}`) on an `attend_class` task updates the linked `class_sessions.status` directly — `true` → `"attended"`, `false` → `null` (unmarked, not `"missed"` — unchecking the task only retracts the attendance confirmation, it doesn't assert you missed the class). Both directions write via a plain, one-directional update in each origin service, never by calling the other's service function, so neither can recurse into the other.
- **`grade_entry` auto-complete**: the same `PATCH /assessments/:id` call that first sets `grade_received` (the trigger for `mastery_deltas`, documented above) also marks any linked, not-yet-done `grade_entry` task complete (`completed_at` stamped) within the same request.

### Notifications — `task_overdue` scoping

`collectTaskOverdue` (`services/notifications.ts`) is scoped to `source: "user"` tasks only, and — like every task read — excludes dismissed tasks. A `system`-sourced task never spawns a duplicate `task_overdue` notification for something it's already surfacing as a task in its own right; the task itself is the reminder.

### Seed data

`scripts/seed.ts`'s demo tasks (see the v1.2 "Seed demo data" section above for the original 6) now carry `description`/`type: 'todo'`; a 7th plain todo ("Take a walk", no course link, due today) demos the dashboard's wellness-chip shape; two of "Start final project outline"'s children ("Pick a project topic" done, "Draft outline sections" open) exercise the `/tasks` modal's subtask chevron/progress-pill UI, which otherwise had no seeded coverage. A new `assessment_kcs` block links 2-3 KCs to each current-term course's near-due official assessment, so the `practice_kc` sweep produces visible rows on first dashboard load without requiring a manual KC link first. No `source: "system"` rows are seeded — that namespace belongs entirely to the sweep, and a seeded row colliding with a sweep-generated `dedupe_key` on re-seed would violate the unique index.

### A note on "Migration NNNN" phrasing

Early v1.x changes were repeatedly folded into a regenerated baseline, so older “Migration NNNN adds…” prose often narrates feature history rather than the current filename. The repository now has a `0000` baseline plus additive `0001`–`0004` migrations; ADR-003's current incremental workflow is authoritative.

---

## v1.6 Additions — class-session timing, session reschedule/delete, task completion notes

**Status**: additive to the FROZEN v1 contract above. No existing field or endpoint shape changed, except `PATCH /class-sessions/:id`'s `status`, which goes from required to **optional** — every existing caller already sends it, and the two-way `attend_class` sync behaves identically whenever `status` is present, so this is backward compatible in practice, not just in principle.

This revision added `class_sessions.start_min`/`end_min` (nullable integers, minutes-from-midnight 0-1439) and `tasks.completion_note` (nullable text); consult the current schema/migration history rather than the historical baseline filename.

### Class sessions — meeting time + note

- `class_sessions` gains `start_min`/`end_min` — nullable integers, minutes-from-midnight of the class day (0-1439), both-or-neither. Sweep-generated (`source: "schedule"`) rows always keep both `null` (all-day semantics unchanged, see `services/classSessions.ts::sweepClassSessions`); only `manual`/`seed` rows may set them.
- `POST /courses/:id/class-sessions` body gains optional `start_min`/`end_min` (integers, 0-1439) — both-or-neither and `end_min > start_min`, enforced at the schema level (`createClassSessionSchema`); violating either fails the request with `400 invalid_input`.
- `PATCH /class-sessions/:id` body's `status` is now **optional** (was required) and the body gains optional `note` (string, max 2000, nullable). A PATCH can now touch just `note` without resending `status` — the `attend_class` two-way sync (see v1.4's "Two-way sync" section) only fires when `status` is actually present in the request, so a note-only PATCH never flips the linked task's completion state. This also unlocks `note`, which was schema-ready but write-unreachable before this.
- `GET /courses/:id/class-sessions` response rows now include `start_min`/`end_min` (raw integers — minute offsets, not timestamps, so `toApi` passes them through unconverted) alongside the now-write-reachable `note`.

### Study sessions — reschedule + delete

Closes the sessions-DELETE deferral (`docs/todo.md`'s v1.2-Specific Deferrals).

- NEW `PATCH /sessions/:id` — body `{ scheduled_at?: ISO, planned_minutes?: number }` (`services/sessions.ts::updateSession`). Reschedules a still-planned session. Rejects with `409 invalid_input` if the session is already completed (`ended_at` set) — distinct from `PATCH /sessions/:id/complete`'s own optional `scheduled_at`, which records a last-second reschedule as part of the same call that finishes the session.
- NEW `DELETE /sessions/:id` — hard delete, ownership-checked (cross-user id → `404 not_found`). No soft-delete/dismissal semantics here — that's a `tasks`-only concept (see v1.4's "dismissal semantics for system tasks").

### Tasks — `completion_note`

- `tasks` gains `completion_note` (nullable text) — a short recap the user can attach when completing any task, not just `attend_class`.
- `PATCH /tasks/:id` body gains optional `completion_note` (string, max 2000, nullable) — settable and clearable independent of `completed`; setting it alone does not stamp or clear `completed_at`.
- The task object (v1.4's "Task object — extended shape") gains `completion_note: string|null`.

### Calendar — `class_session` item type

`GET /calendar` gains a fifth item type, `class_session`, emitted only for a `class_sessions` row with a concrete meeting time (`start_min` **and** `end_min` both non-null):

```json
{
  "id": "uuid (class_sessions.id)",
  "type": "class_session",
  "title": "Class: <course code>",
  "date": "iso (best-effort absolute instant — see timezone note below)",
  "end_date": "iso (best-effort absolute instant — see timezone note below)",
  "all_day": false,
  "course_id": "uuid",
  "href": "/courses/:slug",
  "details": {
    "status": "attended|missed|null",
    "note": "string|null",
    "source": "schedule|manual|seed",
    "task_id": "uuid|null",
    "start_min": "integer, 0-1439",
    "end_min": "integer, 0-1439"
  }
}
```

`details.task_id` is the id of the linked `attend_class` task (joined via `tasks.class_session_id`), or `null` if none exists yet. **Dedupe rule**: whenever a `class_session` item is emitted, its linked `attend_class` task's `task_due` item is suppressed from the same response — a class with a concrete meeting time renders once, not twice. A class session with no meeting time (`start_min`/`end_min` still null) is never emitted as a `class_session` item; its `attend_class` task's `task_due` item remains its only calendar presence, unchanged from v1.4.

**Timezone note — `details.start_min`/`end_min` are the canonical positioning/label source, not `date`/`end_date`.** There is no per-user timezone column anywhere in this schema (`class_sessions.date` and every other "local" timestamp in this app is really UTC — see "Class sessions (v1.3)"'s `localNoon` comment), so `start_min`/`end_min` are stored as plain wall-clock minutes-of-day with no fixed UTC relationship. `date`/`end_date` are computed as `(midnight UTC of the class day) + start_min` — an absolute instant that lands on the right calendar day and reads correctly *only* via UTC-based accessors (`getUTCHours`/`getUTCMinutes`), good enough for cross-item-type sorting/windowing — but a client rendering the actual time-of-day (a position in a day grid, an "10:05 AM" label) **must read it from `details.start_min`/`details.end_min` directly**, never by calling local `Date` getters (`getHours()`) on the ISO fields — that applies the browser's own real UTC offset on top and shows the wrong wall-clock time.

**12h-offset erratum (same-day fix)**: the first implementation of this item computed `date + start_min` directly against `class_sessions.date` (stored at that day's local **noon**, not midnight), landing every timed class 12 hours late (a 10:05 slot came back as 22:05). `getCalendar` now recovers midnight explicitly (`date - 12h`) before adding the minute offset — see the `NOON_OFFSET_MS` comment in `src/lib/services/calendar.ts`. Caught during Track A's planner integration, which is also what surfaced the deeper timezone point above — the 12h fix alone still left `date`/`end_date` unsafe for a client to read a wall-clock hour off of directly, hence `details.start_min`/`end_min` being added as the authoritative source.

### Seed data

`scripts/seed.ts`'s current-term demo courses each get a stable meeting-time slot (10:05-11:25 or 13:35-14:55, cycled per course the same way as the existing meeting-day pattern), applied to every `seed`-sourced `class_sessions` row for that course. This now includes a short window of **future** sessions (1-7 days ahead, always unmarked — attendance can't be known in advance) in addition to the existing ~4-week trailing window, so both the `attend_class` sweep's ±7d window and the new `class_session` calendar projection have upcoming rows to render on first load, not just history.

### Component contract stubs (for the parallel UI tracks)

Two prop interfaces landed frozen, ahead of their real implementations — neither is mounted anywhere yet:

- `src/components/tasks/TaskCheckbox.svelte` — `{ checked: boolean, busy?: boolean, disabled?: boolean, label: string, onToggle: () => void }`. Stub renders a plain `<input type="checkbox">` with `aria-label`.
- `src/components/tasks/CompletionFlow.svelte` — `{ task: ApiTask, onClose: () => void, onCompleted: (opts?: { note?: string }) => void }`. Contract: mounted when a user checks a *typed* (non-todo) task instead of completing it immediately; owns collecting a recap/note (and any type-specific follow-up) and calling the tasks store itself before invoking `onCompleted`; `onClose` cancels without completing. Stub calls `onCompleted()` immediately on mount (pure pass-through).

### Client store — `src/lib/stores/tasks.ts`

- `ApiTask` gains `completion_note?: string | null`.
- `toggleTask(id, opts?: { cascadeChildren?: boolean; completionNote?: string })` — `completionNote` only applies on the false→true edge (toggling back to incomplete ignores it); when set, the PATCH body includes `completion_note`.
- NEW `selectCompleted(tasks: ApiTask[]): ApiTask[]` — completed tasks sorted by `completed_at` descending; the "Ta-Da" tab's data source.

---

## v1.7 Additions — Knowledge graph, scaffolds, misconceptions, corrections, absorb

**Status**: IMPLEMENTED. Services, routes, absorb UI, correction ledger, and content seeding are present. The revision added `kc_edges`, `misconceptions`, `scaffolds`, `user_corrections`, `kcs.slug`, absorb conversation details/mode, and `correction_review`. Content originates from `courses/<slug>/content.json`, validated against `courses/content-schema.md` and seeded by `scripts/seed.ts`.

### GET /kcs/:id/graph

Traverses `kc_edges` from the target KC to build its full prerequisite graph.

**Response** (200):
```json
{
  "data": {
    "kc": { "id": "uuid", "name": "string", "kc_type": "...", "mastery": 0, "status": "..." },
    "prereqs": [
      { "kc_id": "uuid", "slug": "string|null", "name": "string", "kc_type": "fact|association|concept|rule|principle", "mastery": 0, "status": "not-started|learning|review|mastered", "ready": true, "depth": 1, "prereq_kc_ids": ["uuid"] }
    ],
    "warnings": ["string"]
  }
}
```

- **Traversal**: transitive closure over `kc_edges` starting from `:id` (the target KC), following `kc_id → prereq_kc_id` edges outward (i.e. every KC the target depends on, directly or transitively, and everything *those* depend on). Cycle-safe — a visited-set guards against re-entering a node, so a data anomaly (a cycle that slipped past seed-time validation) can't infinite-loop the traversal; a defensively-detected cycle is reported as a string in `warnings` rather than thrown.
- `depth`: shortest number of hops from the target KC to this prereq node (BFS distance, not DFS-first-seen).
- `prereq_kc_ids`: this node's own direct prerequisites (one more hop out), so a client can render nested tree structure without a second call.
- **`ready` rule**: `ready = status !== 'not-started' && mastery >= 40` (the `REVIEW_THRESHOLD` mastery constant, `src/lib/services/mastery.ts::MASTERY_CONSTANTS` — read that file for the authoritative current value if it's changed since this was written). A prereq is "ready" once the learner has engaged with it at all and cleared the review threshold — it does not require `status === 'mastered'`.
- `warnings`: unresolvable states surfaced non-fatally (e.g. a defensively-caught cycle, or a `prereq_kc_id` pointing at a KC the traversal couldn't load) — empty array in the normal case.
- Ownership: `:id` must belong to the caller (`requireOwnedKc`); a cross-course prereq edge (content.json's cross-course refs) is followed regardless of which course it lands in, since KC-level ownership is transitively the same user's data once any course is owned — the route does not re-check ownership per traversed node.

### GET /kcs/:id/scaffolds

**Query**: `kind=<scaffold kind>?`, `max_level=1|2|3?` (inclusive upper bound — `max_level=2` returns level 1 and 2 scaffolds, not just level 2).

**Response** (200): `{ "data": [{ "id", "kc_id", "kind", "level", "title", "body", "details", "source", "created_at" }, ...] }` — serialized rows, ordered `sort_order` ascending. `details` is opaque JSON (e.g. an `interactive_model` spec matching `src/lib/services/tutor/modelSpec.ts`, see the AI Tutor section above) — passed through unvalidated at this boundary.

### GET /kcs/:id/misconceptions

**Response** (200): `{ "data": [{ "id", "kc_id", "slug", "name", "description", "root_cause", "diagnostic_probe", "correction", "source", "created_at" }, ...] }`.

### Corrections (the accepted-correction ledger)

### GET /corrections
**Query**: `status=active|internalized?` (omit for both).

**Response** (200): `{ "data": [Correction, ...] }`, newest (`accepted_at` desc) first. `Correction` shape: all `user_corrections` columns (snake_case, ISO timestamps) plus joined `kc_name` (`string|null`) and `course_slug` (`string|null`) — both populated only when `kc_id` is non-null, `null` otherwise (a freeform correction with no specific KC).

### POST /corrections
**Request**: `{ "kc_id": "uuid"?, "misconception_id": "uuid"?, "prior_belief": "string?", "correction": "string", "source_conversation_id": "uuid"? }` (`src/lib/schemas/corrections.ts::createCorrectionSchema`). `accepted_at` is stamped server-side with the current time — never client-settable. `status` always starts `active`. Any provided id is ownership-checked (`kc_id` via `requireOwnedKc`, `source_conversation_id` via the caller's own `tutor_conversations`); `misconception_id` is validated to exist but has no direct owner of its own (misconceptions are seed content, not user-scoped).

**Response** (201): the created `Correction` (same shape as the list above).

### PATCH /corrections/:id
**Request**: `{ "status": "active"|"internalized"? }` (`updateCorrectionSchema`). Ownership-checked (cross-user id → `404 not_found`).

**Response** (200): the updated `Correction`.

### Flows — quick_quiz explicit KC targeting

`POST /flows/quick_quiz` gains an optional `kc_ids: string[]` (`src/lib/schemas/quickQuiz.ts::createQuickQuizSchema`). When present, it **overrides** the existing mastery-heuristic KC selection entirely — the quiz is built from exactly these KCs (ownership-checked the same way as the existing `kc_id` field), in the order given. Intended for prereq verification ahead of an absorb session (e.g. quiz the KCs a `graph` call flagged as not-yet-`ready`) — `kc_id` (singular) and `kc_ids` (plural) are independent optional fields; if both are omitted, the existing lowest-mastery heuristic applies unchanged.

### Tutor conversations — `absorb` mode

`mode` gains `absorb` (`TUTOR_MODES` in `src/lib/schemas/tutor.ts`) alongside the existing five. `POST /tutor/conversations` gains an optional `details` object:

```json
{ "kc_id": "uuid", "mode": "absorb"?, "details": { "flow": "absorb"?, "focus_order": ["uuid", ...] }? }
```

`details` is stored verbatim on `tutor_conversations.details` (JSON, default `{}`) and echoed back on `GET /tutor/conversations/:id`. For an absorb conversation, `focus_order` is the ordered list of KC ids the flow intends to walk through (typically the not-yet-`ready` prereqs from a prior `GET /kcs/:id/graph` call, target KC last).

**Absorb context assembly**: an absorb conversation's system-prompt context assembly (`conversations.ts`) is a superset of the standard context (documented in the AI Tutor section above) — it additionally includes: the full prereq graph for the target KC (`GET /kcs/:id/graph`'s traversal, inlined), each prereq's readiness, the target KC's `misconceptions`, and its `scaffolds` (all levels). This lets the tutor open with a prereq check when a dependency isn't `ready`, and reach for a matched scaffold or a known misconception's `diagnostic_probe` instead of improvising.

**Correction proposals**: during an absorb conversation, the assistant may emit at most one additional fenced ` ```json ` block per message (independent of, and in addition to, the existing `interactive_model` block — a message could in principle carry both, though in practice a given turn emits one or the other):

```json
{ "type": "correction_proposal", "misconception_slug": "string?", "prior_belief": "string", "correction": "string" }
```

`misconception_slug` is set when the proposal matches a known `misconceptions` row for the KC (client can look up its full record via `GET /kcs/:id/misconceptions`); omitted for a freeform correction the tutor identified that isn't one of the seeded misconceptions. This block is **client-interpreted only** — unlike `interactive_model`, the server does not parse or validate it server-side; the client renders an accept/dismiss affordance and, on accept, calls `POST /corrections` with `{ correction, prior_belief, misconception_id (resolved from the slug via a KC-scoped misconceptions lookup, if present), source_conversation_id }`. Dismissing does nothing server-side (no row is ever created for a dismissed proposal).

### Notifications — `correction_review`

`type` gains `correction_review` (`NOTIFICATION_TYPES` in `src/lib/schemas/notifications.ts`). Swept (same idempotent-sweep idiom as the other five families, `services/notifications.ts`) from `user_corrections` where `status = 'active'` **and** (`last_reminded_at is null and accepted_at < now - 14d`) **or** (`last_reminded_at < now - 14d`) — i.e. an active, not-yet-internalized correction gets a spaced-repetition-style nudge starting 14 days after acceptance, then every 14 days again as long as it stays `active`. Dedupe key: `correction_review:<user_correction_id>:<bucket>` where `bucket = floor(now / 14d)` (a 14-day epoch bucket, not tied to `accepted_at` or `last_reminded_at`) — so at most one `correction_review` notification per correction per 14-day bucket, re-firing in the next bucket if the correction is still active and unreminded-within-window. The sweep is expected to stamp `last_reminded_at = now` on the `user_corrections` row when it inserts the notification (same "sweep writes back to its source row" pattern as `attend_class`'s two-way sync), so a correction that gets `internalized` between sweeps stops generating new notifications immediately (the `status = 'active'` filter excludes it on the next run).

---

## v1.9 Additions — Rituals, Capabilities, ZPD (contract freeze)

**Status**: IMPLEMENTED. Schemas, services, routes, and profile UI are present for rituals, capabilities, and the ZPD frontier. The wire shapes below remain the contract.

### GET /profile/frontier

Computed on read from `kcs` + `kc_edges`, zero persistence (`src/lib/services/zpd.ts::getGlobalFrontier`, `src/lib/schemas/zpd.ts`). Frontier = unmastered KCs whose every prerequisite is `ready` (readiness = `status !== 'not-started' && mastery >= MASTERY_CONSTANTS.REVIEW_THRESHOLD`, the same single definition as `knowledgeMap.ts`'s `isReady`).

**Response** (200):
```json
{
  "data": {
    "by_course": [
      {
        "course_id": "uuid",
        "course_title": "string",
        "course_slug": "string",
        "color": "string|null",
        "frontier": [{ "kc_id": "uuid", "name": "string", "slug": "string|null", "mastery": 0, "status": "not-started|learning|review|mastered" }]
      }
    ],
    "counts": { "frontier": 0, "blocked": 0, "mastered": 0, "total": 0 }
  }
}
```

### GET /profile/capabilities

Returns competencies (higher-order aggregates of KCs across courses, seed- or user-authored) with derived mastery/coverage, plus the fixed 3-item meta-skills catalog (`src/lib/services/capabilities.ts::listCapabilities`/`getMetaSkills`, `src/lib/schemas/capabilities.ts`). Nothing here is stored — mastery/coverage/status and meta-skill counts are all computed on read.

**Response** (200):
```json
{
  "data": {
    "capabilities": [
      {
        "id": "uuid",
        "slug": "string",
        "name": "string",
        "description": "string|null",
        "source": "seed|user",
        "mastery": 0,
        "coverage": 0.0,
        "status": "not-started|learning|review|mastered",
        "members": [{ "kc_id": "uuid", "name": "string", "course_id": "uuid", "mastery": 0, "status": "not-started|learning|review|mastered", "weight": 1 }]
      }
    ],
    "meta_skills": [
      { "key": "retrieval_practice|self_explanation|error_analysis", "count_28d": 0, "count_prior_28d": 0, "trend": "up|flat|down", "last_at": "iso|null" }
    ]
  }
}
```

`status` uses the same `MASTERY_CONSTANTS` thresholds as KCs, but `mastered` additionally requires `coverage === 1` — a competency can't read "mastered" off a fraction of its members. `meta_skills` is deliberately a frequency/trend signal, not a 0-100 score (KLI honesty + anti-gamification, `vision.md`).

### Rituals — `/api/v1/rituals` CRUD

New resource (`src/lib/schemas/rituals.ts`, `src/lib/services/rituals.ts`). A ritual is either a recurring study practice, in-session structure, or both (`kind: 'recurring'|'session_shape'|'both'`).

**`GET /rituals`** — lists the caller's rituals, each with an `adherence` block computed on read (no adherence table): `done_28d`/`generated_28d` from sweep-minted `ritual` tasks over the trailing 28 days (dedupe key `ritual:<ritualId>:<yyyymmdd>`), `session_uses_28d` from `study_sessions.ritualId`, and a 28-day `occurrences` dot row (`done|skipped|upcoming` — never "missed", no streaks/badges).

**`POST /rituals`** — request:
```json
{
  "name": "string",
  "description": "string?",
  "kind": "recurring|session_shape|both",
  "cadence": "daily|weekly|after_class|before_class",
  "by_weekday": "\"[1,3,5]\"",
  "course_id": "uuid?",
  "steps": [{ "kind": "game|warmup|retrieval|new_material|reflect|break", "label": "string?", "minutes": 1 }],
  "active": true
}
```
`by_weekday` follows the exact same JSON-array-string convention as `courses.meetingDays` (ISO weekday numbers Mon=1..Sun=7, e.g. `"[1,3,5]"`, parsed with `parseMeetingDays` from `src/lib/services/classSessions.ts`) — not a bare comma-separated string.

**`PATCH /rituals/:id`** — all fields optional, same shape (nullable where the column is nullable). **`DELETE /rituals/:id`** — hard delete; cascades to `tasks.ritual_id`/`study_sessions.ritual_id` per their FK `onDelete` (cascade / set null respectively).

`GET /rituals/:id` returns one ritual with the same `adherence` block as the list.

### Study sessions — `ritual_id`

`POST /sessions` gains an optional `ritual_id` (a `session_shape`/`both` ritual picked at session start). `StudyFlow.svelte` renders the ritual's `steps` as a guidance step rail — not enforced gates. Independent of `course_id`.

### Tasks — `ritual` type

`type` gains `ritual` (`TASK_TYPES` in `src/lib/schemas/tasks.ts`) alongside the existing six — sweep-generated only, from active rituals (`services/taskSweep.ts::collectRituals`, a seventh collector reusing the `localNoon`/`isoWeekday`/`parseMeetingDays` patterns from `collectPrepBeforeClass`).

### Settings — `task_generators.ritual`

`task_generators` gains a seventh key, `ritual` (default `true`, matching five of the existing six generators — only `prep_before_class`/`stale_kc` ship opt-in). This is the master toggle for the ritual sweep collector; per-ritual on/off is the separate `rituals.active` flag, and a deactivated ritual (or master toggle off) stops generating new tasks without resurrecting dismissed ones (existing dedupe semantics).

---

## Course-map maintenance

### `GET /courses/:id/map`

Returns every branch/KC (including archived nodes), the course's
`map_revision`, prerequisite/dependent ids, active prerequisite candidates from
all caller-owned courses, and pending reviewed-template additions/removals.
The read performs a best-effort reviewed-template refresh; a refresh failure
does not block course access.

### `PUT /courses/:id/map`

Replaces the editable map snapshot atomically. Body:

```json
{
  "expected_revision": 3,
  "branches": [{
    "id": "uuid",
    "name": "Foundations",
    "sort_order": 0,
    "archived": false,
    "kcs": [{
      "id": "uuid",
      "name": "Mass balance",
      "kc_type": "principle",
      "description": "...",
      "practice_notes": "...",
      "sort_order": 0,
      "archived": false,
      "prerequisite_kc_ids": ["uuid"]
    }]
  }]
}
```

New nodes use `client_id` instead of `id`. Existing nodes must remain in the
snapshot and use `archived: true` rather than being omitted. Returns `409` for
a stale revision, graph cycle, non-owned prerequisite, active dependent of an
archived prerequisite, or removal of the final meaningful active KC.

### `POST /courses/:id/template-updates`

Body: `{ "expected_revision": 3, "actions": [{ "item_kind": "branch|kc",
"template_ref": "stable-ref", "action": "include|dismiss|archive|keep" }] }`.
Inclusion clones the current reviewed rich content and required same-course
prerequisites. Dismiss/keep decisions are durable. Archive preserves learner
history. Returns the refreshed course-map response.

## v2.0 Additions — Exercise bank

**Status**: LANDED (schema, Zod mirror, service, routes, QuickQuiz integration, KC-detail UI), additive. Auto-gradeable / self-checkable exercises attached to KCs — the complement to scaffolds (which teach, no answers). Schema: new `exercises` table (`src/db/schema.ts`), populated from `courses/<slug>/exercises.json` (sibling file to `content.json`, frozen contract `courses/exercise-schema.md`) by `scripts/seed.ts`, validated by the Zod mirror in `src/lib/content/exercises.ts`.

`POST /flows/quick_quiz` (see above) now prefers this seeded bank: for each picked KC with at least one seeded `mcq` exercise, the quiz uses one of those (server-side grading, no AI call for that KC) instead of generating a question via OpenRouter; only KCs with no seeded `mcq` items fall through to the existing AI path. If every picked KC has a seeded item, the OpenRouter call is skipped entirely — quick_quiz works with no `OPENROUTER_API_KEY` set. `submitQuickQuizAnswers` is unchanged (item-shape-agnostic); event payload/channel (`retrieval_practice`, `payload.channel: "quick_quiz"`, `source: "tutor"`) is identical regardless of whether an item came from the seeded bank or AI generation. Implementation: `src/lib/flows/quick_quiz.ts::loadSeededMcqByKc`.

### GET /kcs/:id/exercises

**Query**: `kind=mcq|numeric|worked?` (omit for all kinds).

**Response** (200): `{ "data": [Exercise, ...] }`, ordered `sort_order` ascending. `Exercise` shape: `{ "id", "kc_id", "slug", "kind", "difficulty", "prompt", "details", "source", "origin", "sort_order", "created_at" }` — `details` is answer-stripped per `kind`:

- `mcq`: `details = { "options": ["string", ...] }` — no `correct_index`/`explanation`.
- `numeric`: `details = { "unit": "string|null" }` — no `value`/`tolerance_pct`/`solution`.
- `worked`: `details = { "solution": "string" }` — the solution *is* the content, so it's never stripped.

Ownership: `:id` must belong to the caller (`requireOwnedKc`). The full (answer-included) `details` payload — `listKcExercises(db, userId, kcId, { withAnswers: true })` — and the course-wide mcq bank (`listCourseMcqBank(db, userId, courseId)`, full details, used by QuickQuiz's server-side grading) are service-layer only; no route returns either directly to a client.

Rendered on the KC detail page (`/courses/:slug/kc/:kcId`) by `src/components/kc/ExercisesSection.svelte`, grouped by kind: mcq items are a selectable option list graded via the attempt endpoint below; numeric items are a value input + unit label; worked items show a "Show solution" disclosure (no attempt call — the solution is already in the answer-stripped response).

### POST /exercises/:id/attempt

Grades a submitted attempt against exercise `:id` and appends one `retrieval_practice` event on its KC — the assess-and-check counterpart to `POST /flows/quick_quiz/:id/answers`. Ownership: `:id`'s KC must belong to the caller (`getExerciseWithAnswers`, 404 otherwise).

**Body**: exactly one of:
- `{ "value": number }` — numeric attempt.
- `{ "selected_index": number }` — mcq attempt (accepted now for the KC-detail UI; also usable by a future QuickQuiz-from-bank review flow).

A body shape that doesn't match the exercise's actual `kind` (including `worked`, which has no gradeable attempt) returns `400 invalid_input`.

**Response** (200): `{ "data": { ...graded, "mastery_deltas": [...] } }` where `graded` is kind-specific:

- numeric: `{ "correct": boolean, "answer": { "value": number, "unit": "string|null" }, "solution": "string" }` — correct iff `|submitted - answer.value| <= tolerance_pct% of |answer.value|` (from the seeded `answer.tolerance_pct`).
- mcq: `{ "correct": boolean, "correct_index": number, "explanation": "string" }`.

Event: `type: "retrieval_practice"`, `kc_id` = the exercise's KC, `payload: { correct, exercise_id, channel: "exercise" }`, `source: "tutor"` — same non-manual "flow-computed correctness check" idiom as quick_quiz's grading events (not the `POST /events` default of `"manual"`). Implementation: `src/lib/flows/exercise_attempt.ts::gradeExerciseAttempt`.

---

## Global Next Move

### GET /profile/next-move

Computes the learner's highest-value learning action across active, owned
courses. This endpoint never returns tasks or persists recommendations. Query:
`available_minutes=15|25|50` (optional, default `25`; other values return `400
invalid_input`).

Candidate ranking is deterministic: 40% assessment urgency (ungraded, dated,
official assessments in the next 30 days), 30% mastery need, 20% recency, and
10% prerequisite leverage. Assessment weight is a tie-break. A blocked
assessment target redirects recursively to an actionable prerequisite, which
may belong to another active owned course. Mastered KCs are excluded from the
generic frontier but may be recommended for an imminent assessment retrieval
check.

**Response** (200):

```json
{
  "data": {
    "generated_at": "iso",
    "available_minutes": 25,
    "recommendation": {
      "action_id": "quick_quiz:kc-id:assessment-id:25",
      "kind": "assessment_practice|prerequisite_repair|stale_review|frontier_understand",
      "method": "understand|quick_quiz",
      "title": "Mass balance",
      "course": {
        "course_id": "uuid",
        "course_slug": "mass-transfer",
        "course_code": "CHEE 310",
        "course_title": "Mass Transfer",
        "color": "264"
      },
      "kc": { "kc_id": "uuid", "name": "Mass balance", "mastery": 55, "status": "review" },
      "assessment": {
        "assessment_id": "uuid",
        "title": "Midterm",
        "due_at": "iso",
        "weight_pct": 25
      },
      "planned_minutes": 25,
      "question_count": 5,
      "action_href": "/study/quiz?kc=uuid&course=uuid&minutes=25&autostart=1",
      "reasons": [{ "code": "assessment_urgency", "label": "Midterm is due in 3 days · 25% of the course" }]
    },
    "alternatives": []
  }
}
```

`recommendation` is `null` when no actionable active KC exists;
`alternatives` contains at most two items. Every move includes `time_fit` among
its reason codes. For `understand`, `question_count` is `null` and
`action_href` is `/learn/:kcId?minutes=...`.

### Recommendation-launched learning flows

`POST /flows/quick_quiz` additionally accepts `planned_minutes: 15|25|50`. An
explicit singular `kc_id` together with explicit `count` requests that many
non-repeating authored MCQs for the same KC, using AI only to fill a short
bank. Global Next Move maps 15/25/50 minutes to 3/5/8 questions and only chooses
Quick Quiz when the active authored bank can fill the request; other existing
Quick Quiz selection modes retain their prior behavior. The resulting
`study_sessions.planned_minutes` records the plan.

An Understand launch passes the same `minutes` query value into the absorb
conversation's opaque `details.planned_minutes`; prompt assembly uses it for
pacing but does not promise exact completion. Following or cycling a recommendation
is product-usage telemetry, not a learner-domain event. The UI therefore does not
post those actions to `/events`; `recommendation_followed` and
`recommendation_ignored` are sent through the deliberate behavioral wrapper, after a
same-recommendation `next_move_viewed` impression.
