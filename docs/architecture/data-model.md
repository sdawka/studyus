# studyus Data Model

**Re-derived 2026-08-15 from `src/db/schema.ts` and `migrations/0000_chemical_ink.sql`** (the sole migration file — see ADR-003's "Schema Management" section for why this is a single regenerated baseline, not an incremental history; this filename is the v1.6 regen, superseding the v1.5-era `0000_yielding_nocturne.sql`). Column names below are the actual snake_case DB names; `src/db/schema.ts` uses camelCase Drizzle field names that map onto them (e.g. `userId` → `user_id`). Every table's primary key is `id` (text, UUID from `crypto.randomUUID()`) unless noted otherwise; every table has `created_at` (integer epoch ms) unless noted.

Timestamps are epoch-ms integers in the DB; the API boundary (`src/lib/serialize.ts::toApi`) converts every `_at`/`_date` field (plus `ts` and `date`) to an ISO 8601 string — see `docs/api.md`.

## Tables (Drizzle + D1)

### users

- `id` (text, pk)
- `email` (text, **unique**) — login identity; there is no `username` column
- `password_hash` (text)
- `name` (text, nullable)
- `current_term` (text, nullable) — default term filter for calendar/courses (e.g., `"Winter 2025"`)
- `settings` (text, JSON mode, default `'{}'`) — resolved via `resolveSettings`/`DEFAULT_SETTINGS` in `src/lib/services/user.ts`; holds `theme`, `scheme`, `sidebar_collapsed`, `task_generators` (see `docs/api.md`)
- `onboarded_at` (integer, nullable) — stamped once by the onboarding stepper
- `created_at`

No `updated_at`. Not user-scoped by a `user_id` FK (it's the root of the ownership graph).

### sessions

- `id` (text, pk) — **this is not a random session id: it's the lowercase-hex SHA-256 digest of the random session token itself.** The token is given to the client as the `studyus_session` cookie and never stored; a leaked DB row can't be replayed as a cookie. There is no separate `token_hash` column — `id` *is* the hash. See `src/lib/auth/session.ts`.
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `expires_at` (integer) — 30-day sliding expiry, renewed once the session is within 15 days of expiring (`RENEW_THRESHOLD_MS` in `session.ts`)
- `created_at`

### courses

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `code` (text) — e.g., `"CHEM 213"`
- `slug` (text, **unique**) — collision-suffixed at create time (`-2`, `-3`, ...)
- `title` (text)
- `credits` (integer, nullable)
- `term` (text, nullable) — free-text string (e.g., `"Winter 2025"`), not a date range — there's no term-start/end modeling yet
- `instructor` (text, nullable)
- `prereqs` (text, nullable)
- `overview` (text, nullable)
- `source_url` (text, nullable)
- `color` (text, nullable) — stores an OKLCH hue as text (`color_hue` at the API boundary); falls back client-side to a hash of the slug when absent (`src/lib/courseHue.ts`)
- `meeting_days` (text, nullable) — JSON array of ISO weekday numbers (Mon=1..Sun=7), e.g. `"[1,3,5]"`; `null` = no fixed meeting schedule. Drives the class-sessions generation sweep.
- `archived` (integer/boolean, default `false`) — soft-delete; excluded by default from `listCourses` and every picker
- `created_at`

**No `updated_at` column**, despite being a frequently-PATCHed table.

### branches

- `id` (text, pk)
- `course_id` → `courses.id`, **ON DELETE CASCADE**
- `name` (text) — e.g., "Unit 1: Reaction Mechanisms"
- `sort_order` (integer, default `0`)
- `created_at`

**No `user_id` column** (ownership is via `course_id` → `courses.user_id`) and **no `description` column**.

### kcs (Knowledge Components)

- `id` (text, pk)
- `branch_id` → `branches.id`, **ON DELETE CASCADE**
- `course_id` → `courses.id`, **ON DELETE CASCADE**
- `name` (text) — e.g., "SN2 Mechanism"
- `kc_type` (text enum: `fact | association | concept | rule | principle`, default `concept`)
- `description` (text, nullable)
- `practice_notes` (text, nullable)
- `sort_order` (integer, default `0`)
- `mastery` (integer, 0–100, default `0`) — **derived cache**, recomputed on every event write via `foldMastery` (see `events-and-mastery.md`)
- `status` (text, default `'not-started'`) — one of `not-started | learning | review | mastered` (`KC_STATUSES` in `src/lib/services/mastery.ts`; **not** `not_started`/`in_progress` as a prior draft of this doc claimed)
- `last_event_at` (integer, nullable) — most recent event timestamp for this KC, used as the idle-decay anchor
- `created_at`

**No `user_id` column** (ownership is via `course_id`). Index: `kcs_course_id_idx` on (`course_id`).

### events — the source of truth for mastery

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `ts` (integer) — when the event occurred (may differ from `created_at`)
- `type` (text, free string — see `src/lib/schemas/events.ts::EVENT_ROLE_FLAGS` for the 12 recognized values and their role-flag mapping, reproduced in `docs/api.md`)
- `is_instructional` (integer/boolean, default `false`) — derived server-side from `type`, not client-settable
- `is_assessment` (integer/boolean, default `false`) — same
- `kc_id` → `kcs.id`, nullable, **ON DELETE SET NULL**
- `course_id` → `courses.id`, nullable, **ON DELETE SET NULL** — nullable (not "always present" as a prior draft claimed); course-scoped events without a course context can exist
- `session_id` (text, nullable) — **not a real foreign key.** It's a plain text column with no `.references()` in `schema.ts` and no FK constraint in the migration, despite conceptually pointing at `study_sessions.id`.
- `payload` (text, JSON mode, default `'{}'`) — event-specific data; see `mastery.ts::eventSuccess` for the fields the fold actually reads (`correct`, `correctness`, `score`, `self_rating`)
- `source` (text enum: `manual | session | tutor | seed`)
- `created_at`

**No `updated_at` column** — a manual event edit (`PATCH /events/:id`) updates fields in place with no separate edited-at stamp. Indexes: `events_kc_id_idx` on (`kc_id`), `events_user_ts_idx` on (`user_id`, `ts`).

### assessments

- `id` (text, pk)
- `course_id` → `courses.id`, **ON DELETE CASCADE**
- `title` (text)
- `type` (text enum: `quiz | assignment | midterm | final | lab`)
- `due_date` (integer, nullable)
- `weight_pct` (integer, nullable) — 0–100
- `grade_received` (integer, nullable)
- `grade_max` (integer, nullable)
- `kind` (text enum: `official | practice`, default `'official'`) — **v1.3.1**: `official` assessments count toward the weighted grade; `practice` never does, even when graded (`services/grades.ts`, `services/practiceSummary.ts`)
- `created_at`

**No `user_id` column** (ownership is via `course_id`). Index: `assessments_course_id_idx` on (`course_id`).

### assessment_kcs

- `id` (text, pk)
- `assessment_id` → `assessments.id`, **ON DELETE CASCADE**
- `kc_id` → `kcs.id`, **ON DELETE CASCADE**
- `qmatrix_version` (integer, default `1`) — versioned KC-to-assessment mapping
- `created_at`

**No `sort_order` column.**

### notes

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `title` (text)
- `body` (text, default `''`) — the note's markdown content; maps to `content` at the API boundary (`shapeNote` in `services/notes.ts`)
- `created_at`
- `updated_at` (integer, `$defaultFn` to `Date.now()`, stamped on every write)

### note_links

- `id` (text, pk)
- `note_id` → `notes.id`, **ON DELETE CASCADE**
- `course_id` → `courses.id`, nullable, **ON DELETE CASCADE**
- `kc_id` → `kcs.id`, nullable, **ON DELETE CASCADE**
- `created_at`

### attachments

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `course_id` → `courses.id`, nullable, **ON DELETE SET NULL**
- `note_id` → `notes.id`, nullable, **ON DELETE SET NULL** — present in the schema, but `services/attachments.ts::createAttachment` never sets it; every attachment created through the current API is course-scoped only. Note-scoped attachments are schema-ready but not wired to any route yet.
- `r2_key` (text) — real convention is `${userId}/${courseId}/${id}-${safeName}` (`services/attachments.ts:20`, matches `docs/api.md`) — **not** `attachments/{userId}/{courseSlug}/{filename}` as ADR-006 originally claimed (see that ADR's erratum)
- `filename` (text) — original filename
- `content_type` (text, nullable)
- `size_bytes` (integer, nullable)
- `created_at`

Upload size is capped at `MAX_ATTACHMENT_BYTES` = 10 MB (`src/lib/schemas/attachments.ts`), checked against `file.size` before the file is buffered into memory; exceeding it fails with `400 invalid_input`. No MIME allow/deny list exists — any content type is accepted.

### tasks (v1.4: task-centric platform)

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `title` (text)
- `description` (text, nullable) — user-supplied for `todo`s; sweep-generated system tasks always carry a non-null, human-readable description (e.g. `"Class session — CHEM 213"`, `"${kcName} is linked to ${assessmentTitle}"` — see `services/taskSweep.ts`)
- `due_date` (integer, nullable)
- `done` (integer/boolean, default `false`) — the `completed` field at the API boundary
- `type` (text enum, default `'todo'`): `todo | attend_class | prep_before_class | review_after_class | practice_kc | stale_kc | grade_entry` (`TASK_TYPES` in `src/lib/schemas/tasks.ts`) — only `todo` is user-mintable (`createTaskSchema`/`updateTaskSchema` have no `type` field); the other six are sweep-only
- `parent_task_id` → `tasks.id` (self-referential), nullable, **ON DELETE CASCADE** — one level of subtasks; a parent must not itself have a `parent_task_id` (enforced in `services/tasks.ts`, a DB lookup, not a column constraint); create-only, no re-parenting via `PATCH`
- `completed_at` (integer, nullable) — stamped/cleared only on an actual `done` transition
- `completion_note` (text, nullable) — **v1.6**: an optional short recap the user can attach when completing any task (not just `attend_class`), via `PATCH /tasks/:id`'s `completion_note`; independent of `description` and of `completed`/`completed_at`
- `dismissed_at` (integer, nullable) — system-task soft delete; **never serialized**
- `course_id` → `courses.id`, nullable, **ON DELETE CASCADE**
- `class_session_id` → `class_sessions.id`, nullable, **ON DELETE CASCADE**
- `assessment_id` → `assessments.id`, nullable, **ON DELETE CASCADE**
- `kc_id` → `kcs.id`, nullable, **ON DELETE CASCADE** — these four are the origin FKs for sweep-generated tasks; all `null` for a user-minted todo
- `dedupe_key` (text, nullable, **unique-indexed**) — sweep idempotency key (e.g. `attend_class:<class_session_id>`); `NULL` is unconstrained under SQLite's multi-NULL unique semantics, so every user todo's `NULL` coexists fine; **never serialized**
- `source` (text enum: `user | system`, default `'user'`)
- `created_at`

Indexes: `tasks_dedupe_key_unique` (unique, `dedupe_key`), `tasks_user_dismissed_due_idx` on (`user_id`, `dismissed_at`, `due_date`), `tasks_parent_idx` on (`parent_task_id`).

### task_courses

- `id` (text, pk)
- `task_id` → `tasks.id`, **ON DELETE CASCADE**
- `course_id` → `courses.id`, **ON DELETE CASCADE**

Index: `task_courses_task_course_unique` (unique, on `task_id` + `course_id`) — backs the sweep's idempotent origin-course link backfill (see `services/taskSweep.ts`, `docs/api.md`'s v1.4 section).

### resources

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `url` (text)
- `label` (text)
- `kind` (text enum: `canonical | feed | user_shared`) — no default; always supplied
- `course_id` → `courses.id`, nullable, **ON DELETE SET NULL**
- `kc_id` → `kcs.id`, nullable, **ON DELETE SET NULL**
- `pinned` (integer/boolean, default `false`)
- `added_by` (text, nullable) — **`'seed'` or a user's UUID** (`users.id`), not the three-way `"seed" | "user" | "admin"` enum a prior draft claimed; there is no `"admin"` value or role concept anywhere in the schema
- `created_at`

### study_sessions

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `course_id` → `courses.id`, nullable, **ON DELETE SET NULL**
- `intended_event_type` (text) — free string; resolved to a real event type on completion, falling back to `practice_done` if unrecognized
- `planned_minutes` (integer, nullable)
- `started_at` (integer) — **not nullable**; for a planned (not-yet-started) session created via `scheduled_at`, this is stamped with the same value so ordering/filtering by `started_at` still works
- `ended_at` (integer, nullable)
- `scheduled_at` (integer, nullable) — planner-created sessions; added post-M1 (see `docs/api.md`'s v1.2 Additions)
- `reflection` (text, nullable) — also reused as a JSON blob for quick-quiz storage (see `docs/api.md`'s Agentic Flows section)
- `created_at`

Indexes: `study_sessions_user_scheduled_idx` on (`user_id`, `scheduled_at`), `study_sessions_user_started_idx` on (`user_id`, `started_at`) — `calendar.ts` needs both because it filters on `COALESCE(scheduled_at, started_at)`, which SQLite can't index directly; either single-column index lets the planner query hit one side of the coalesce.

### session_kcs

- `id` (text, pk)
- `study_session_id` → `study_sessions.id`, **ON DELETE CASCADE** — the FK column is `study_session_id`, **not** `session_id`
- `kc_id` → `kcs.id`, **ON DELETE CASCADE**

No additional index beyond the implicit primary key.

### tutor_conversations

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `kc_id` → `kcs.id`, **ON DELETE CASCADE**
- `mode` (text enum: `recall | classify | worked_example | self_explain | interactive_model`)
- `created_at`

### tutor_messages

- `id` (text, pk)
- `conversation_id` → `tutor_conversations.id`, **ON DELETE CASCADE**
- `role` (text enum: `user | assistant | system`) — **includes `system`**, not just `user | assistant`
- `content` (text)
- `created_at`

### notifications (v1.1)

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `type` (text enum: `assessment_due | task_overdue | kc_review | session_unfinished | grade_recorded`)
- `title` (text)
- `body` (text, nullable)
- `course_id` → `courses.id`, nullable, **ON DELETE SET NULL**
- `href` (text)
- `dedupe_key` (text, **unique**) — sweep idempotency key, e.g. `assessment_due:<id>`, `task_overdue:<id>:<dueDate>`
- `read_at` (integer, nullable)
- `created_at`

Index: `notifications_user_read_created_idx` on (`user_id`, `read_at`, `created_at`).

### class_sessions (v1.3)

Attendance is modeled as **pre-existing scheduled rows whose status gets updated**, generated by an idempotent sweep from `courses.meeting_days` — not events appended by a button click.

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `course_id` → `courses.id`, **ON DELETE CASCADE**
- `date` (integer) — epoch ms at **local noon** of the class day (noon avoids a TZ day-shift when converting to/from ISO at the API boundary)
- `status` (text enum: `attended | missed`, nullable) — `null` = unmarked
- `note` (text, nullable)
- `source` (text enum: `schedule | manual | seed`, default `'schedule'`)
- `start_min` / `end_min` (integer, nullable) — **v1.6**: minutes-from-midnight (0-1439) of the class day, for a session with a concrete meeting time; both-or-neither. Sweep-generated (`source: 'schedule'`) rows always keep both `null` — only `manual`/`seed` rows may set them. Powers `getCalendar`'s `class_session` item (`src/lib/services/calendar.ts`), emitted only when both are non-null
- `created_at`

Index: `class_sessions_course_date_unique` (unique, on `course_id` + `date`).

## Index Inventory (full, from `migrations/0000_chemical_ink.sql`)

Every non-PK index currently in the schema:

| Index | Table | Columns | Unique |
|---|---|---|---|
| `assessments_course_id_idx` | assessments | course_id | |
| `class_sessions_course_date_unique` | class_sessions | course_id, date | ✓ |
| `courses_slug_unique` | courses | slug | ✓ |
| `events_kc_id_idx` | events | kc_id | |
| `events_user_ts_idx` | events | user_id, ts | |
| `kcs_course_id_idx` | kcs | course_id | |
| `notifications_dedupe_key_unique` | notifications | dedupe_key | ✓ |
| `notifications_user_read_created_idx` | notifications | user_id, read_at, created_at | |
| `study_sessions_user_scheduled_idx` | study_sessions | user_id, scheduled_at | |
| `study_sessions_user_started_idx` | study_sessions | user_id, started_at | |
| `task_courses_task_course_unique` | task_courses | task_id, course_id | ✓ |
| `tasks_dedupe_key_unique` | tasks | dedupe_key | ✓ |
| `tasks_user_dismissed_due_idx` | tasks | user_id, dismissed_at, due_date | |
| `tasks_parent_idx` | tasks | parent_task_id | |
| `users_email_unique` | users | email | ✓ |

Every table's `id` primary key is implicitly indexed by SQLite on top of the above. This inventory was regenerated alongside the baseline migration (see ADR-003's erratum) — prior drafts of this document and ADR-003 claimed "no indexing strategy defined post-v1," which is no longer true.

## Foreign Keys & ON DELETE Behavior (full inventory)

All FKs below are real SQL `FOREIGN KEY ... ON DELETE ...` constraints emitted into `migrations/0000_chemical_ink.sql` from each column's `.references()` call in `schema.ts` — **D1 does enforce these**, contrary to a stale claim in ADR-003 (see that ADR's erratum).

| Column | References | ON DELETE |
|---|---|---|
| sessions.user_id | users.id | cascade |
| courses.user_id | users.id | cascade |
| branches.course_id | courses.id | cascade |
| kcs.branch_id | branches.id | cascade |
| kcs.course_id | courses.id | cascade |
| events.user_id | users.id | cascade |
| events.kc_id | kcs.id | set null |
| events.course_id | courses.id | set null |
| events.session_id | *(none — plain text column, not a real FK)* | — |
| assessments.course_id | courses.id | cascade |
| assessment_kcs.assessment_id | assessments.id | cascade |
| assessment_kcs.kc_id | kcs.id | cascade |
| notes.user_id | users.id | cascade |
| note_links.note_id | notes.id | cascade |
| note_links.course_id | courses.id | cascade |
| note_links.kc_id | kcs.id | cascade |
| attachments.user_id | users.id | cascade |
| attachments.course_id | courses.id | set null |
| attachments.note_id | notes.id | set null |
| tasks.user_id | users.id | cascade |
| tasks.parent_task_id | tasks.id (self) | cascade |
| tasks.course_id | courses.id | cascade |
| tasks.class_session_id | class_sessions.id | cascade |
| tasks.assessment_id | assessments.id | cascade |
| tasks.kc_id | kcs.id | cascade |
| task_courses.task_id | tasks.id | cascade |
| task_courses.course_id | courses.id | cascade |
| resources.user_id | users.id | cascade |
| resources.course_id | courses.id | set null |
| resources.kc_id | kcs.id | set null |
| study_sessions.user_id | users.id | cascade |
| study_sessions.course_id | courses.id | set null |
| session_kcs.study_session_id | study_sessions.id | cascade |
| session_kcs.kc_id | kcs.id | cascade |
| tutor_conversations.user_id | users.id | cascade |
| tutor_conversations.kc_id | kcs.id | cascade |
| tutor_messages.conversation_id | tutor_conversations.id | cascade |
| notifications.user_id | users.id | cascade |
| notifications.course_id | courses.id | set null |
| class_sessions.user_id | users.id | cascade |
| class_sessions.course_id | courses.id | cascade |

## LearnerProfile (Aggregation Service, Not a Table)

`GET /profile` (`src/lib/services/profile.ts::getProfile`) computes and returns a transient object — matches the actual service/route shape exactly (a prior draft of this doc invented a `masteryByBranch` field and camelCase keys that don't exist in the real response):

```json
{
  "user_id": "uuid",
  "overall_mastery": 65,
  "by_course": [{ "course_id": "uuid", "course_title": "string", "mastery": 0 }],
  "longest_streak": 15,
  "current_streak": 3,
  "recent_events": [ /* last 20 events, newest first */ ],
  "knowledge_map": null
}
```

There is **no branch-level mastery rollup** — `by_course` is the only breakdown, computed by averaging each course's KCs' `mastery` cache (courses with no KCs get `0`). `overall_mastery` averages only the courses with a non-zero mastery. `current_streak`/`longest_streak` are consecutive-UTC-calendar-day counts with ≥1 event; `current_streak` is `0` unless the most recent event day is today or yesterday. `knowledge_map` is an explicit `null` stub — no implementation exists.

This is NOT stored — it's computed server-side on every request from `courses`, `kcs` (mastery column), and `events`.

## TODO

- Knowledge map table design (concept graph, prerequisite edges, transitive mastery closure).
- Versioning strategy for qmatrix and KC taxonomy (how to migrate existing mappings).
- Archival & data retention policy (how long do we keep old events?).
- `attachments.note_id` is schema-ready (nullable FK, `ON DELETE SET NULL`) but has no writer yet — either wire a note-scoped upload route or drop the column if it stays unused.
