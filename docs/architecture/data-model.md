# studyus Data Model

## Tables (Drizzle + D1)

All tables are user_id-scoped for future multi-user support. Relationships are normalized; no denormalization except caches (mastery, status on kcs).

### Core Identity

**users**
- `id` (text, pk) — UUID
- `username` (text, unique)
- `password_hash` (text) — PBKDF2 now, argon2-WASM post-v1
- `name` (text)
- `current_term` (text) — Default term filter for calendar/courses (e.g., "Fall 2024")
- `created_at` (datetime)

**sessions**
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `token_hash` (text) — SHA-256(random 32 bytes), stored; comparison via constant-time hash
- `expires_at` (datetime) — 30 days from creation (sliding on each request)
- `created_at` (datetime)

### Courses & Curriculum

**courses**
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `code` (text) — e.g., "CHEM 213"
- `slug` (text) — URL-safe unique per user (e.g., "chem-213")
- `title` (text) — e.g., "Organic Chemistry I"
- `credits` (decimal) — e.g., 3.0
- `term` (text) — "Fall 2024", "Winter 2025", "Full Year 2024-2025"
- `instructor` (text)
- `prereqs` (text) — Notes on prerequisites
- `overview` (text) — Course description
- `source_url` (text) — Link to course homepage or LMS
- `color` (text) — Hex color for UI (e.g., "#FF5733")
- `archived` (boolean) — Soft-delete; excluded from default views
- `created_at` (datetime)
- `updated_at` (datetime)

**branches**
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `course_id` (text, fk → courses)
- `name` (text) — E.g., "Unit 1: Reaction Mechanisms"
- `description` (text)
- `sort_order` (int)
- `created_at` (datetime)

**kcs** (Knowledge Components)
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `branch_id` (text, fk → branches)
- `course_id` (text, fk → courses)
- `name` (text) — E.g., "SN2 Mechanism"
- `kc_type` (enum: fact | association | concept | rule | principle) — Default: concept
- `description` (text)
- `practice_notes` (text)
- `sort_order` (int)
- **Derived/cached:**
  - `mastery` (int, 0–100) — Recomputed on event write
  - `status` (text: "not_started" | "in_progress" | "review" | "mastered") — Based on mastery + recency
  - `last_event_at` (datetime) — Most recent event for exponential decay
- `created_at` (datetime)

### Learning Events

**events** (Append-only but editable)
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `ts` (datetime) — Event occurred at
- `type` (enum: lecture_attended | lecture_missed | video_watched | reading_done | taught_someone | quiz_taken | assignment_graded | exam_graded | self_assessment | practice_done | retrieval_practice | tutor_session) — Semantic event type
- `is_instructional` (boolean) — True if this event provides instruction/exposure
- `is_assessment` (boolean) — True if this event measures performance
- `kc_id` (text, fk → kcs) — Optional; null for course-scoped events like lecture attendance
- `course_id` (text, fk → courses) — Always present for context
- `session_id` (text, fk → study_sessions) — Optional; links to a study session
- `payload` (json) — Event-specific data:
  - `quiz_taken`: `{score: 0-100, max_score: 100}`
  - `assignment_graded`, `exam_graded`: `{grade_received: float, grade_max: float}`
  - `self_assessment`: `{confidence: 0-100}`
  - `tutor_session`: `{transcript_id: uuid, mode: "recall"|"classify"|"worked_example"|"self_explain"|"interactive_model", final_rating: 0-5}`
  - `lecture_attended`: `{lecture_name?: string}`
  - Other types: `{}`
- `source` (enum: manual | session | tutor | seed) — Where the event came from
- `created_at` (datetime)
- `updated_at` (datetime) — For manual edits

**assessment_kcs**
- `id` (text, pk) — UUID
- `assessment_id` (text, fk → assessments)
- `kc_id` (text, fk → kcs)
- `qmatrix_version` (int, default 1) — Versioned KC-to-assessment mapping for historical consistency
- `sort_order` (int)

### Assessments & Grades

**assessments**
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `course_id` (text, fk → courses)
- `title` (text) — E.g., "Midterm"
- `type` (enum: quiz | assignment | midterm | final | lab)
- `due_date` (datetime)
- `weight_pct` (decimal) — 0–100; normalized per course
- `grade_received` (decimal) — Latest grade entered; nullable
- `grade_max` (decimal) — For normalization (e.g., 100)
- `created_at` (datetime)

When a grade is entered/updated, append an `assignment_graded` event linked to all `assessment_kcs` for this assessment.

### Study & Practice

**study_sessions**
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `course_id` (text, fk → courses)
- `intended_event_type` (text) — E.g., "retrieval_practice", "reading_done"
- `planned_minutes` (int)
- `started_at` (datetime)
- `ended_at` (datetime) — Optional; null if in progress
- `reflection` (text) — Student's notes on what they studied

**session_kcs**
- `id` (text, pk) — UUID
- `session_id` (text, fk → study_sessions)
- `kc_id` (text, fk → kcs)

Completing a study session appends a `practice_done` or matching event to the log.

**tutor_conversations**
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `kc_id` (text, fk → kcs)
- `mode` (enum: recall | classify | worked_example | self_explain | interactive_model) — Selected by KC type
- `created_at` (datetime)

**tutor_messages**
- `id` (text, pk) — UUID
- `conversation_id` (text, fk → tutor_conversations)
- `role` (enum: user | assistant)
- `content` (text)
- `created_at` (datetime)

Closing a conversation appends a `tutor_session` event.

### Notes & Resources

**notes**
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `title` (text)
- `content` (text) — Markdown
- `created_at` (datetime)
- `updated_at` (datetime)

**note_links**
- `id` (text, pk) — UUID
- `note_id` (text, fk → notes)
- `course_id` (text, fk → courses) — Optional; link to a course
- `kc_id` (text, fk → kcs) — Optional; link to a KC

**resources**
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `url` (text) — Full URL
- `label` (text) — Display name
- `kind` (enum: canonical | feed | user_shared) — Source: curated seed, geek-feed, user-added
- `course_id` (text, fk → courses) — Optional; null if course-agnostic
- `kc_id` (text, fk → kcs) — Optional; link to specific KC
- `pinned` (boolean) — User's manual sort
- `added_by` (text) — "seed" | "user" | "admin"
- `created_at` (datetime)

**attachments** (Files uploaded to R2)
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `course_id` (text, fk → courses)
- `r2_key` (text) — Path in R2 bucket (e.g., "attachments/{userId}/{courseSlug}/{filename}")
- `original_filename` (text)
- `mime_type` (text)
- `file_size` (int) — Bytes
- `created_at` (datetime)

### Tasks & Planning

**tasks** (v1.4: task-centric platform — real rows for every checkable thing, user todos and sweep-generated system tasks alike, not virtual projections)
- `id` (text, pk) — UUID
- `user_id` (text, fk → users)
- `title` (text)
- `description` (text, nullable)
- `due_date` (datetime, nullable)
- `done` (boolean) — the `completed` field at the API boundary
- `type` (enum: `todo | attend_class | prep_before_class | review_after_class | practice_kc | stale_kc | grade_entry`, default `todo`) — only `todo` is user-mintable (`createTaskSchema`/`updateTaskSchema` have no `type` field); the other six are written only by the sweep, below
- `parent_task_id` (text, fk → tasks, self-referential, cascade delete) — one level of subtasks; a parent must not itself have a `parent_task_id` (enforced in `services/tasks.ts`, a DB lookup, not expressible as a column constraint); create-only, no re-parenting via `PATCH`
- `completed_at` (datetime, nullable) — stamped/cleared only on an actual `done` transition, not a redundant same-value `PATCH`
- `dismissed_at` (datetime, nullable) — system-task soft delete (see Dedupe & dismissal below); **never serialized**
- `course_id` / `class_session_id` / `assessment_id` / `kc_id` (fks, all nullable, all cascade delete) — origin of a sweep-generated task; all `null` for a user-minted todo
- `dedupe_key` (text, nullable, unique-indexed — SQLite's multi-NULL unique semantics mean every user todo's `NULL` is unconstrained) — sweep idempotency key, e.g. `attend_class:<class_session_id>`; **never serialized**
- `source` (enum: `user | system`, default `user`)
- `created_at` (datetime)

Indexed on `(user_id, done, due_date)` and `(parent_task_id)`, in addition to the `dedupe_key` unique index above.

**task_courses**
- `id` (text, pk) — UUID
- `task_id` (text, fk → tasks, cascade delete)
- `course_id` (text, fk → courses, cascade delete)
- Unique on `(task_id, course_id)` — backs the sweep's idempotent origin-course link backfill, below

**Generation**: six independently-toggleable generator families (`settings.task_generators`; policy table and defaults in `docs/api.md`'s "v1.4 Additions" section) run as an idempotent sweep (`services/taskSweep.ts`) — the same idiom as the notifications and class-sessions sweeps: collect candidate rows per family, `INSERT ... ON CONFLICT(dedupe_key) DO NOTHING`, invoked at the top of both `listTasks` and `getCalendar` (never behind a dedicated endpoint). A system task's `course_id`/`class_session_id`/`assessment_id`/`kc_id` records what generated it. `task_courses` link rows for those origin courses are backfilled in a **second pass** after the insert batch — `ON CONFLICT DO NOTHING` doesn't report which row survived a dedupe collision, so the sweep can't know which task id to link in the same batch as the insert; the second pass instead re-reads system tasks with a `course_id` missing their `task_courses` row and backfills them, itself idempotent via the unique index above.

**Dedupe & dismissal**: a sweep-generated row is uniquely keyed by `dedupe_key`, so re-running the sweep never creates a duplicate. Deleting a `source: "user"` task hard-deletes it (cascading to children); deleting a `source: "system"` task instead stamps `dismissed_at` (soft delete) and hard-deletes its children — the row, and its `dedupe_key`, survive so the generating sweep can never resurrect it. Dismissed rows are excluded from every list/calendar read and purged once `dismissed_at` is more than 120 days old.

**Two-way sync**: an `attend_class` task's completion mirrors its linked `class_sessions.status` in both directions (checking the task marks the session attended; marking a session attended completes the task, and vice versa for unmarking), and entering an assessment's grade auto-completes its linked `grade_entry` task — each direction writes via a plain, one-directional `db.update` in its own origin service, never by calling back into the other's service function, so neither direction can recurse into the other.

## LearnerProfile (Aggregation Service, Not a Table)

`GET /profile` computes and returns a transient object:

```typescript
{
  userId: string;
  name: string;
  overallMastery: number; // 0–100, weighted across all KCs
  masteryByBranch: {
    branchId: string;
    branchName: string;
    mastery: number; // 0–100
  }[];
  masteryByCourse: {
    courseId: string;
    courseTitle: string;
    mastery: number; // 0–100
  }[];
  longestStreak: number; // Days of consecutive events
  currentStreak: number; // Days since last event
  recentEvents: Event[]; // Last ~20 events
  knowledgeMap: null; // TODO: post-v1
}
```

This is NOT stored — it's computed server-side from kcs (mastery column) and events.

## TODO

- Knowledge map table design (concept graph, prerequisite edges, transitive mastery closure).
- Versioning strategy for qmatrix and KC taxonomy (how to migrate existing mappings).
- Indexing strategy (on user_id, course_id, kc_id for query performance).
- Archival & data retention policy (how long do we keep old events?).
