# studyus Data Model

**Re-derived 2026-08-15, updated 2026-08-19 for v1.9, from `src/db/schema.ts` and `migrations/0000_dashing_cammi.sql`** (the sole migration file — see ADR-003's "Schema Management" section for why this is a single regenerated baseline, not an incremental history; this filename is the v1.9 regen — capabilities/capability_kcs/rituals + tasks.ritual_id/study_sessions.ritual_id — superseding the v1.6-era `0000_chemical_ink.sql`, which itself superseded the v1.5-era `0000_yielding_nocturne.sql`).

**Glossary note**: "capability" means two different things in this codebase, deliberately not unified. The `capabilities` table (below) is a **domain noun** — a competency a learner is building. Elsewhere (`docs/architecture/overview.md`, `agentic-channels.md`), "capability" was used loosely to mean *a pure service function* — those two docs were reworded to say "service function" instead once the domain table landed, to kill the collision at the source rather than footnote around it. Column names below are the actual snake_case DB names; `src/db/schema.ts` uses camelCase Drizzle field names that map onto them (e.g. `userId` → `user_id`). Every table's primary key is `id` (text, UUID from `crypto.randomUUID()`) unless noted otherwise; every table has `created_at` (integer epoch ms) unless noted.

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
- `slug` (text, nullable) — **v1.7**: stable kebab-case slug from `courses/<slug>/content.json` (e.g. `"bernoulli-equation"`); `null` for legacy (non-content.json) KCs
- `created_at`

**No `user_id` column** (ownership is via `course_id`). Indexes: `kcs_course_id_idx` on (`course_id`); `kcs_course_slug_unique` (unique, v1.7) on (`course_id`, `slug`) — SQLite's multi-NULL unique semantics let every legacy `NULL` slug coexist fine.

### kc_edges (v1.7 — knowledge graph)

Prerequisite edges between KCs: `(kc_id)` depends on `(prereq_kc_id)`.

- `id` (text, pk)
- `kc_id` → `kcs.id`, **ON DELETE CASCADE** — the dependent KC
- `prereq_kc_id` → `kcs.id`, **ON DELETE CASCADE** — the prerequisite KC
- `relation` (text enum: `prerequisite`, default `'prerequisite'`)
- `source` (text enum: `seed | user`, default `'seed'`)
- `created_at`

**No `user_id` column** (ownership flows `kc_id` → `kcs.course_id` → `courses.user_id`, same as `assessment_kcs`). May cross courses (a cross-course prereq ref in `content.json`), so there's no single `course_id` column either. Indexes: `kc_edges_kc_prereq_unique` (unique) on (`kc_id`, `prereq_kc_id`); `kc_edges_prereq_kc_id_idx` on (`prereq_kc_id`).

### capabilities (v1.9 — competencies)

Higher-order aggregates of KCs, deliberately allowed to cross course boundaries — see `events-and-mastery.md`'s Capabilities section for the derived-mastery fold (`src/lib/capabilityMastery.ts`) and `courses/content-schema.md` for the seed file format.

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE** — user-scoped, not course-scoped (a competency is cross-course by design, so there's no single `course_id` to hang it off)
- `slug` (text) — unique per user
- `name` (text)
- `description` (text, nullable)
- `source` (text enum: `seed | user`, default `'seed'`) — `'user'` is schema-ready; there's no authoring UI for it yet, only `courses/capabilities.json`
- `created_at`

Index: `capabilities_user_slug_unique` (unique) on (`user_id`, `slug`).

### capability_kcs (v1.9)

The membership join: which KCs roll up into a competency, and how heavily.

- `id` (text, pk)
- `capability_id` → `capabilities.id`, **ON DELETE CASCADE**
- `kc_id` → `kcs.id`, **ON DELETE CASCADE**
- `weight` (integer, default `1`) — relative weight in the weighted-mean mastery fold; a plain unweighted mean when every member's weight is `1` (the common case)
- `created_at`

Indexes: `capability_kcs_capability_kc_unique` (unique) on (`capability_id`, `kc_id`); `capability_kcs_kc_id_idx` on (`kc_id`).

### misconceptions (v1.7)

- `id` (text, pk)
- `kc_id` → `kcs.id`, **ON DELETE CASCADE**
- `slug` (text) — unique within the KC
- `name` (text)
- `description` (text) — the wrong belief, stated in the learner's voice/logic
- `root_cause` (text) — where the belief comes from (prior intuition, overgeneralized rule, surface-feature pattern)
- `diagnostic_probe` (text) — a question whose answer reveals whether the learner holds the misconception
- `correction` (text) — the canonical corrected statement; this exact text becomes a `user_corrections.correction` ledger entry when accepted in the tutor
- `source` (text enum: `seed | tutor`, default `'seed'`)
- `created_at`

**No `user_id` column** (ownership via `kc_id`). Index: `misconceptions_kc_slug_unique` (unique) on (`kc_id`, `slug`).

### scaffolds (v1.7)

KLI-matched instructional scaffolds for a KC (worked examples, retrieval prompts, etc. — see `courses/content-schema.md`'s `kc_type` → scaffold-kind mapping table, grounded in `events-and-mastery.md`'s KLI taxonomy).

- `id` (text, pk)
- `kc_id` → `kcs.id`, **ON DELETE CASCADE**
- `kind` (text enum: `retrieval_prompt | mnemonic | matching_drill | classification_task | contrast_examples | worked_example | procedure_outline | self_explanation_prompt | derivation_walkthrough | interactive_model | analogy`)
- `level` (integer, default `1`) — support level: `1` = high support (fully worked/heavily cued), `2` = medium (partially faded/hinted), `3` = low (independent/bare prompt); used for fading ladders on `rule` KCs
- `title` (text)
- `body` (text) — markdown; the actual scaffold content a tutor or the UI presents verbatim
- `details` (text, JSON mode, default `'{}'`) — opaque JSON; for `interactive_model` a model spec matching `src/lib/services/tutor/modelSpec.ts` (see `docs/api.md`'s AI Tutor section)
- `sort_order` (integer, default `0`)
- `source` (text enum: `seed | user`, default `'seed'`)
- `created_at`

**No `user_id` column** (ownership via `kc_id`). Index: `scaffolds_kc_id_idx` on (`kc_id`).

### user_corrections (v1.7 — the accepted-correction ledger)

Entries created when a tutor's fenced `correction_proposal` (absorb flow) is accepted by the client, or manually via `POST /corrections`.

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `kc_id` → `kcs.id`, nullable, **ON DELETE SET NULL**
- `misconception_id` → `misconceptions.id`, nullable, **ON DELETE SET NULL**
- `prior_belief` (text, nullable)
- `correction` (text) — not nullable; the canonical corrected statement (often copied verbatim from `misconceptions.correction`)
- `status` (text enum: `active | internalized`, default `'active'`)
- `accepted_at` (integer) — not nullable; stamped server-side, never client-settable
- `source_conversation_id` → `tutor_conversations.id`, nullable, **ON DELETE SET NULL**
- `last_reminded_at` (integer, nullable) — last time the `correction_review` notification fired for this entry
- `created_at`

Index: `user_corrections_user_status_idx` on (`user_id`, `status`).

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
- `ritual_id` → `rituals.id`, nullable, **ON DELETE CASCADE** — **v1.9**: set on a sweep-minted `ritual` task (the fifth origin FK, alongside the four above); `type` gains a `'ritual'` value in `TASK_TYPES` (`src/lib/schemas/tasks.ts`) for these rows
- `dedupe_key` (text, nullable, **unique-indexed**) — sweep idempotency key (e.g. `attend_class:<class_session_id>`, or `ritual:<ritual_id>:<yyyymmdd>` for a ritual occurrence); `NULL` is unconstrained under SQLite's multi-NULL unique semantics, so every user todo's `NULL` coexists fine; **never serialized**
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
- `ritual_id` → `rituals.id`, nullable, **ON DELETE SET NULL** — **v1.9**: which session-shape ritual (if any) this session was started with; the session-shape adherence signal (`services/rituals.ts::listRitualsWithAdherence` counts these rows over a trailing window) — **set null**, not cascade, since deleting a ritual shouldn't delete session history
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
- `mode` (text enum: `recall | classify | worked_example | self_explain | interactive_model | absorb`) — **v1.7** adds `absorb`
- `details` (text, JSON mode, default `'{}'`) — **v1.7**: flow-specific extras, e.g. `{flow: 'absorb', focus_order: [kcId, ...]}` for an absorb conversation's prereq traversal order
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
- `type` (text enum: `assessment_due | task_overdue | kc_review | session_unfinished | grade_recorded | correction_review`) — **v1.7** adds `correction_review`
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

### rituals (v1.9)

A learner-authored study structure — recurring practice, in-session shape, or both. See `events-and-mastery.md`'s Rituals section for the deliberate-practice/self-regulation framing and the anti-gamification adherence rules.

- `id` (text, pk)
- `user_id` → `users.id`, **ON DELETE CASCADE**
- `name` (text)
- `description` (text, nullable)
- `kind` (text enum: `recurring | session_shape | both`)
- `cadence` (text enum: `daily | weekly | after_class | before_class`, nullable) — nullable because a pure `session_shape` ritual doesn't schedule anything
- `by_weekday` (text, nullable) — same JSON-array-string convention as `courses.meeting_days` (e.g. `"[1,3,5]"`, ISO weekday numbers Mon=1..Sun=7), parsed with `parseMeetingDays` (`src/lib/services/classSessions.ts`); only meaningful when `cadence = 'weekly'`
- `course_id` → `courses.id`, nullable, **ON DELETE CASCADE** — set only for an `after_class`/`before_class` cadence, which keys off that course's `class_sessions`
- `steps` (text, JSON mode, nullable) — array of `{kind: 'game'|'warmup'|'retrieval'|'new_material'|'reflect'|'break', label?, minutes?}`; a guidance step rail for `session_shape`/`both` rituals (`StudyFlow.svelte` renders it, not enforced — see the events-and-mastery.md section), `null` for a plain `recurring` ritual with no in-session structure
- `group_id` (text, nullable) — **reserved for a future group scope; always `null` in v1, no FK (groups don't exist yet).** The read rule every service query applies is **`user_id = ? AND group_id IS NULL`** (see `requireOwnedRitual`/`listRitualsWithAdherence` in `services/rituals.ts`) — a group-scoped ritual, if this scope is ever built, would need its own read path rather than silently falling into a user's personal list.
- `active` (integer/boolean, default `true`) — per-ritual on/off; the sweep's `ritual` master toggle (`settings.task_generators.ritual`) gates the whole collector, this flag gates one ritual within it. A dismissed sweep-minted task can't resurrect even if reactivated (existing dedupe-key semantics).
- `created_at`

**No adherence table** (ADR-004, computed on read) — recurring adherence folds sweep-minted `ritual` tasks (`tasks.ritual_id`, dedupe key `ritual:<ritual_id>:<yyyymmdd>`) over a trailing window; session-shape adherence folds `study_sessions.ritual_id` usage over the same window. Index: `rituals_user_id_idx` on (`user_id`).

## Index Inventory (full, from `migrations/0000_dashing_cammi.sql`)

Every non-PK index currently in the schema:

| Index | Table | Columns | Unique |
|---|---|---|---|
| `assessments_course_id_idx` | assessments | course_id | |
| `class_sessions_course_date_unique` | class_sessions | course_id, date | ✓ |
| `courses_slug_unique` | courses | slug | ✓ |
| `events_kc_id_idx` | events | kc_id | |
| `events_user_ts_idx` | events | user_id, ts | |
| `kcs_course_id_idx` | kcs | course_id | |
| `kcs_course_slug_unique` | kcs | course_id, slug | ✓ |
| `kc_edges_kc_prereq_unique` | kc_edges | kc_id, prereq_kc_id | ✓ |
| `kc_edges_prereq_kc_id_idx` | kc_edges | prereq_kc_id | |
| `capabilities_user_slug_unique` | capabilities | user_id, slug | ✓ |
| `capability_kcs_capability_kc_unique` | capability_kcs | capability_id, kc_id | ✓ |
| `capability_kcs_kc_id_idx` | capability_kcs | kc_id | |
| `rituals_user_id_idx` | rituals | user_id | |
| `misconceptions_kc_slug_unique` | misconceptions | kc_id, slug | ✓ |
| `scaffolds_kc_id_idx` | scaffolds | kc_id | |
| `user_corrections_user_status_idx` | user_corrections | user_id, status | |
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

All FKs below are real SQL `FOREIGN KEY ... ON DELETE ...` constraints emitted into `migrations/0000_dashing_cammi.sql` from each column's `.references()` call in `schema.ts` — **D1 does enforce these**, contrary to a stale claim in ADR-003 (see that ADR's erratum).

| Column | References | ON DELETE |
|---|---|---|
| sessions.user_id | users.id | cascade |
| courses.user_id | users.id | cascade |
| branches.course_id | courses.id | cascade |
| kcs.branch_id | branches.id | cascade |
| kcs.course_id | courses.id | cascade |
| kc_edges.kc_id | kcs.id | cascade |
| kc_edges.prereq_kc_id | kcs.id | cascade |
| capabilities.user_id | users.id | cascade |
| capability_kcs.capability_id | capabilities.id | cascade |
| capability_kcs.kc_id | kcs.id | cascade |
| rituals.user_id | users.id | cascade |
| rituals.course_id | courses.id | cascade |
| tasks.ritual_id | rituals.id | cascade |
| study_sessions.ritual_id | rituals.id | set null |
| misconceptions.kc_id | kcs.id | cascade |
| scaffolds.kc_id | kcs.id | cascade |
| user_corrections.user_id | users.id | cascade |
| user_corrections.kc_id | kcs.id | set null |
| user_corrections.misconception_id | misconceptions.id | set null |
| user_corrections.source_conversation_id | tutor_conversations.id | set null |
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

There is **no branch-level mastery rollup** — `by_course` is the only breakdown, computed by averaging each course's KCs' `mastery` cache (courses with no KCs get `0`). `overall_mastery` averages only the courses with a non-zero mastery. `current_streak`/`longest_streak` are consecutive-UTC-calendar-day counts with ≥1 event; `current_streak` is `0` unless the most recent event day is today or yesterday. **`knowledge_map` (v1.9)**: no longer an explicit `null` stub — it's `getGlobalFrontier`'s `counts` object (`{frontier, blocked, mastered, total}`, `src/lib/zpd.ts`/`src/lib/services/zpd.ts`), reusing that same single pass over `kcs`/`kc_edges` rather than a second bespoke query. The `/profile` page itself calls `getGlobalFrontier` a second time, directly, to get the full `by_course` breakdown the `FrontierPanel` needs (this response object only carries the summary counts) — a known duplicate-call candidate for a future dedupe, see `docs/todo.md`.

This is NOT stored — it's computed server-side on every request from `courses`, `kcs` (mastery column), and `events`.

## TODO

- ~~Knowledge map table design (concept graph, prerequisite edges, transitive mastery closure).~~ **Done, v1.7**: `kc_edges` models prerequisite edges; `GET /api/v1/kcs/:id/graph` (`docs/api.md`'s v1.7 section) computes the transitive-closure traversal + readiness at request time — there is still no persisted mastery-closure cache, just the edge table and a pure traversal. **v1.9 addendum**: `GET /api/v1/profile/frontier` (`src/lib/services/zpd.ts`) is the same idea from the other direction — instead of one KC's own prereq graph, it computes every *ready-to-learn* KC across all courses (the "coming later" `LearnerProfile.knowledge_map` this section used to flag is what shipped it) — still a pure per-request traversal over `kcs`/`kc_edges`, no new persisted structure.
- Versioning strategy for qmatrix and KC taxonomy (how to migrate existing mappings).
- Archival & data retention policy (how long do we keep old events?).
- `attachments.note_id` is schema-ready (nullable FK, `ON DELETE SET NULL`) but has no writer yet — either wire a note-scoped upload route or drop the column if it stays unused.
