import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, primaryKey, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { TASK_TYPES } from '../lib/schemas/tasks';

// Convention: text ids via crypto.randomUUID(); integer timestamps in epoch ms.
const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now());

// ---------------------------------------------------------------------------
// Users & sessions
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: id(),
  // Clerk is the authentication authority. `id` remains the immutable
  // application/tenant identifier so every existing D1 foreign key stays
  // valid through the auth migration.
  clerkUserId: text('clerk_user_id').unique(),
  email: text('email').notNull().unique(),
  // Retained solely for migration compatibility. New Clerk-provisioned rows
  // receive a non-verifying sentinel while legacy rows retain their hash.
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  currentTerm: text('current_term'),
  institutionName: text('institution_name'),
  programName: text('program_name'),
  // IANA timezone used for calendar wall-time and date-only interpretation.
  // UTC is a safe migration default; onboarding/settings should replace it
  // with the browser-resolved zone for active users.
  timezone: text('timezone').notNull().default('UTC'),
  settings: text('settings', { mode: 'json' })
    .notNull()
    .default(sql`'{}'`),
  onboardedAt: integer('onboarded_at'),
  createdAt: createdAt(),
});

export const sessions = sqliteTable('sessions', {
  // sha256 hex digest of the random session token; the token itself is never stored.
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: createdAt(),
});

export const academicTerms = sqliteTable(
  'academic_terms',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    startsOn: integer('starts_on').notNull(),
    endsOn: integer('ends_on').notNull(),
    timezone: text('timezone').notNull(),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [index('academic_terms_user_current_idx').on(table.userId, table.isCurrent)],
);

// ---------------------------------------------------------------------------
// Courses / branches / KCs
// ---------------------------------------------------------------------------

export const courses = sqliteTable(
  'courses',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    // Stable reviewed-catalog provenance. Null for manual/uploaded courses.
    templateId: text('template_id'),
    mapRevision: integer('map_revision').notNull().default(1),
    templateRevision: text('template_revision'),
    templateSyncedAt: integer('template_synced_at'),
    templateBaseline: text('template_baseline', { mode: 'json' }),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    // Holds fractional values despite the integer() declaration: the McGill
    // catalog has 678 courses at 0.25-17.33 credits, and SQLite's INTEGER
    // affinity stores a REAL unchanged when narrowing would lose precision.
    // See the round-trip tests in tests/courses-create.test.ts.
    credits: integer('credits'),
    term: text('term'),
    termId: text('term_id').references(() => academicTerms.id, { onDelete: 'set null' }),
    instructor: text('instructor'),
    prereqs: text('prereqs'),
    overview: text('overview'),
    sourceUrl: text('source_url'),
    color: text('color'),
    // JSON array of ISO weekday numbers (Mon=1..Sun=7), e.g. "[1,3,5]"; null
    // means the course has no fixed meeting schedule. Drives the class
    // sessions generation sweep — see classSessions below.
    meetingDays: text('meeting_days'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    setupState: text('setup_state', { enum: ['draft', 'active'] }).notNull().default('active'),
    createdAt: createdAt(),
  },
  (table) => [index('courses_user_template_idx').on(table.userId, table.templateId)],
);

export const branches = sqliteTable('branches', {
  id: id(),
  courseId: text('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  templateRef: text('template_ref'),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: integer('archived_at'),
  createdAt: createdAt(),
});

// KLI taxonomy: fact | association | concept | rule | principle
export const kcs = sqliteTable(
  'kcs',
  {
    id: id(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kcType: text('kc_type', {
      enum: ['fact', 'association', 'concept', 'rule', 'principle'],
    })
      .notNull()
      .default('concept'),
    description: text('description'),
    practiceNotes: text('practice_notes'),
    // v1.7: stable kebab-case slug from courses/<slug>/content.json (e.g.
    // "bernoulli-equation"), nullable for legacy (non-content.json) KCs.
    // Unique per course (see kcsCourseSlugUnique below) — SQLite's multi-NULL
    // unique semantics let every legacy NULL slug coexist fine.
    slug: text('slug'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: integer('archived_at'),
    // Derived caches, recomputed on every event write.
    mastery: integer('mastery').notNull().default(0), // 0-100
    status: text('status').notNull().default('not-started'),
    lastEventAt: integer('last_event_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('kcs_course_id_idx').on(table.courseId),
    uniqueIndex('kcs_course_slug_unique').on(table.courseId, table.slug),
  ],
);

// ---------------------------------------------------------------------------
// Knowledge graph, scaffolds, misconceptions (v1.7 — courses/<slug>/content.json)
// ---------------------------------------------------------------------------

// Capabilities — higher-order competencies aggregating KCs across courses
// (see src/lib/capabilityMastery.ts for the derived mastery/coverage fold).
// User-scoped: competencies are cross-course, so ownership lives here
// directly rather than flowing through a course.
export const capabilities = sqliteTable(
  'capabilities',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    source: text('source', { enum: ['seed', 'user'] }).notNull().default('seed'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('capabilities_user_slug_unique').on(table.userId, table.slug)],
);

export const capabilityKcs = sqliteTable(
  'capability_kcs',
  {
    id: id(),
    capabilityId: text('capability_id')
      .notNull()
      .references(() => capabilities.id, { onDelete: 'cascade' }),
    kcId: text('kc_id')
      .notNull()
      .references(() => kcs.id, { onDelete: 'cascade' }),
    weight: integer('weight').notNull().default(1),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('capability_kcs_capability_kc_unique').on(table.capabilityId, table.kcId),
    index('capability_kcs_kc_id_idx').on(table.kcId),
  ],
);

// Prerequisite edges between KCs: (kcId) depends on (prereqKcId). No
// user_id — ownership flows through kcId -> kcs.courseId -> courses.userId,
// same as assessment_kcs. May cross courses (a cross-course prereq ref in
// content.json), so no single course_id column either.
export const kcEdges = sqliteTable(
  'kc_edges',
  {
    id: id(),
    kcId: text('kc_id')
      .notNull()
      .references(() => kcs.id, { onDelete: 'cascade' }),
    prereqKcId: text('prereq_kc_id')
      .notNull()
      .references(() => kcs.id, { onDelete: 'cascade' }),
    relation: text('relation', { enum: ['prerequisite'] }).notNull().default('prerequisite'),
    source: text('source', { enum: ['seed', 'user'] }).notNull().default('seed'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('kc_edges_kc_prereq_unique').on(table.kcId, table.prereqKcId),
    index('kc_edges_prereq_kc_id_idx').on(table.prereqKcId),
  ],
);

export const misconceptions = sqliteTable(
  'misconceptions',
  {
    id: id(),
    kcId: text('kc_id')
      .notNull()
      .references(() => kcs.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    rootCause: text('root_cause').notNull(),
    diagnosticProbe: text('diagnostic_probe').notNull(),
    correction: text('correction').notNull(),
    source: text('source', { enum: ['seed', 'tutor'] }).notNull().default('seed'),
    retiredAt: integer('retired_at'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('misconceptions_kc_slug_unique').on(table.kcId, table.slug)],
);

// KLI-matched instructional scaffolds for a KC (worked examples, retrieval
// prompts, etc. — see courses/content-schema.md's kc_type -> scaffold kind
// mapping table). `level` = support level: 1 = high support, 2 = medium,
// 3 = low/independent — used for fading ladders on `rule` KCs.
export const scaffolds = sqliteTable(
  'scaffolds',
  {
    id: id(),
    kcId: text('kc_id')
      .notNull()
      .references(() => kcs.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: [
        'retrieval_prompt',
        'mnemonic',
        'matching_drill',
        'classification_task',
        'contrast_examples',
        'worked_example',
        'procedure_outline',
        'self_explanation_prompt',
        'derivation_walkthrough',
        'interactive_model',
        'analogy',
      ],
    }).notNull(),
    level: integer('level').notNull().default(1),
    title: text('title').notNull(),
    body: text('body').notNull(),
    // Opaque JSON — e.g. an interactive_model spec matching
    // src/lib/services/tutor/modelSpec.ts (see docs/api.md AI Tutor section).
    details: text('details', { mode: 'json' })
      .notNull()
      .default(sql`'{}'`),
    sortOrder: integer('sort_order').notNull().default(0),
    source: text('source', { enum: ['seed', 'user'] }).notNull().default('seed'),
    createdAt: createdAt(),
  },
  (table) => [index('scaffolds_kc_id_idx').on(table.kcId)],
);

// Auto-gradeable / self-checkable exercise bank for a KC (v2.0 —
// courses/<slug>/exercises.json, sibling file to content.json — see
// courses/exercise-schema.md for the frozen authoring contract). Complements
// scaffolds (which teach, no answers) with assess-and-check items: `mcq`
// (seeded QuickQuiz bank items), `numeric` (tolerance-checked practice), and
// `worked` (study material with a full solution). `details` is the
// kind-specific payload (mcq: {options, correct_index, explanation}; numeric:
// {answer: {value, unit, tolerance_pct}, solution}; worked: {solution}) —
// opaque JSON here, shaped by the Zod mirror in src/lib/content/exercises.ts.
// Column named `origin` (not `source`) because `source` already holds the
// authoring citation (textbook/chapter, per exercise-schema.md).
export const exercises = sqliteTable(
  'exercises',
  {
    id: id(),
    kcId: text('kc_id')
      .notNull()
      .references(() => kcs.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    kind: text('kind', { enum: ['mcq', 'numeric', 'worked'] }).notNull(),
    // Mirrors scaffold fading: 1 = supported/recall, 2 = standard, 3 = independent/transfer.
    difficulty: integer('difficulty').notNull().default(2),
    prompt: text('prompt').notNull(),
    details: text('details', { mode: 'json' })
      .notNull()
      .default(sql`'{}'`),
    source: text('source').notNull(),
    // Generated items are durable bank content, not transient model output.
    // They remain distinguishable from authored seed content and learner-made
    // items so a future authoring review can filter or replace them safely.
    origin: text('origin', { enum: ['seed', 'user', 'generated'] }).notNull().default('seed'),
    sortOrder: integer('sort_order').notNull().default(0),
    retiredAt: integer('retired_at'),
    createdAt: createdAt(),
  },
  (table) => [
    // Slug-keyed like misconceptions (not index-keyed like scaffolds), so
    // reordering the authoring file is safe and removals purge cleanly.
    uniqueIndex('exercises_kc_slug_unique').on(table.kcId, table.slug),
    index('exercises_kc_id_idx').on(table.kcId),
  ],
);

// ---------------------------------------------------------------------------
// Events — the source of truth for mastery
// ---------------------------------------------------------------------------

export const events = sqliteTable(
  'events',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ts: integer('ts').notNull(),
    type: text('type').notNull(),
    isInstructional: integer('is_instructional', { mode: 'boolean' }).notNull().default(false),
    isAssessment: integer('is_assessment', { mode: 'boolean' }).notNull().default(false),
    kcId: text('kc_id').references(() => kcs.id, { onDelete: 'set null' }),
    courseId: text('course_id').references(() => courses.id, { onDelete: 'set null' }),
    sessionId: text('session_id'),
    payload: text('payload', { mode: 'json' })
      .notNull()
      .default(sql`'{}'`),
    source: text('source', { enum: ['manual', 'session', 'tutor', 'seed', 'system'] }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('events_kc_id_idx').on(table.kcId),
    index('events_user_ts_idx').on(table.userId, table.ts),
    index('events_session_id_idx').on(table.sessionId),
  ],
);

// Browser event POSTs use a tenant-scoped request key rather than the event
// primary key. Keeping this as a separate ledger preserves the key after a
// manually logged event is deleted: ON DELETE SET NULL turns that row into a
// tombstone, so an ambiguous late retry cannot recreate deliberately removed
// mastery evidence.
export const eventIdempotencyKeys = sqliteTable(
  'event_idempotency_keys',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    eventId: text('event_id').references(() => events.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.idempotencyKey] }),
    uniqueIndex('event_idempotency_keys_event_id_unique').on(table.eventId),
  ],
);

// Durable Object transcripts are intentionally not mirrored into D1. This
// compact ledger makes their single D1-side session event idempotent across
// stream retries and explicit end requests.
export const runtimeTutorSessionEvents = sqliteTable(
  'runtime_tutor_session_events',
  {
    conversationId: text('conversation_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index('runtime_tutor_session_events_user_id_idx').on(table.userId),
  ],
);

// One row makes browser-draft imports idempotent across auth redirects and
// retries. Simulated demo evidence is excluded at the API schema boundary.
export const onboardingImports = sqliteTable(
  'onboarding_imports',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceDraftId: text('source_draft_id').notNull(),
    courseId: text('course_id').references(() => courses.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('onboarding_imports_user_draft_unique').on(table.userId, table.sourceDraftId)],
);

export const courseTemplateDecisions = sqliteTable(
  'course_template_decisions',
  {
    id: id(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    itemKind: text('item_kind', { enum: ['branch', 'kc'] }).notNull(),
    templateRef: text('template_ref').notNull(),
    decision: text('decision', { enum: ['dismissed', 'kept'] }).notNull(),
    templateRevision: text('template_revision').notNull(),
    createdAt: createdAt(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [uniqueIndex('course_template_decisions_item_unique').on(table.courseId, table.itemKind, table.templateRef)],
);

export const demoFunnelEvents = sqliteTable(
  'demo_funnel_events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    name: text('name').notNull(),
    step: text('step'),
    scenarioId: text('scenario_id'),
    occurredAt: integer('occurred_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('demo_funnel_events_session_idx').on(table.sessionId, table.createdAt)],
);

// ---------------------------------------------------------------------------
// Assessments & grades
// ---------------------------------------------------------------------------

export const assessments = sqliteTable(
  'assessments',
  {
    id: id(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type', {
      enum: ['quiz', 'assignment', 'midterm', 'final', 'lab'],
    }).notNull(),
    dueDate: integer('due_date'),
    weightPct: integer('weight_pct'),
    gradeReceived: integer('grade_received'),
    gradeMax: integer('grade_max'),
    // v1.3.1: 'official' assessments count toward the weighted grade;
    // 'practice' ones never do, even when graded — see services/grades.ts and
    // services/practiceSummary.ts.
    kind: text('kind', { enum: ['official', 'practice'] }).notNull().default('official'),
    createdAt: createdAt(),
  },
  (table) => [index('assessments_course_id_idx').on(table.courseId)],
);

export const assessmentKcs = sqliteTable('assessment_kcs', {
  id: id(),
  assessmentId: text('assessment_id')
    .notNull()
    .references(() => assessments.id, { onDelete: 'cascade' }),
  kcId: text('kc_id')
    .notNull()
    .references(() => kcs.id, { onDelete: 'cascade' }),
  qmatrixVersion: integer('qmatrix_version').notNull().default(1),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Notes & attachments
// ---------------------------------------------------------------------------

export const notes = sqliteTable('notes', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now()),
});

export const noteLinks = sqliteTable('note_links', {
  id: id(),
  noteId: text('note_id')
    .notNull()
    .references(() => notes.id, { onDelete: 'cascade' }),
  courseId: text('course_id').references(() => courses.id, { onDelete: 'cascade' }),
  kcId: text('kc_id').references(() => kcs.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
});

export const attachments = sqliteTable('attachments', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  courseId: text('course_id').references(() => courses.id, { onDelete: 'set null' }),
  noteId: text('note_id').references(() => notes.id, { onDelete: 'set null' }),
  r2Key: text('r2_key').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type'),
  sizeBytes: integer('size_bytes'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Rituals — recurring study practices ("Sunday weekly review") and/or
// in-session structure (warm-up -> retrieval -> reflect). `groupId` is a
// forward-looking hook for a future group scope (groups don't exist yet —
// always null in v1; the read rule is `userId = ? AND group_id IS NULL`, see
// data-model.md). No adherence table — adherence is computed on read from
// ritual-generated tasks (tasks.ritualId) and study_sessions.ritualId.
// ---------------------------------------------------------------------------

export const rituals = sqliteTable(
  'rituals',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind', { enum: ['recurring', 'session_shape', 'both'] }).notNull(),
    cadence: text('cadence', { enum: ['daily', 'weekly', 'after_class', 'before_class'] }),
    // Same JSON-array-string convention as courses.meetingDays (e.g.
    // "[1,3,5]", ISO weekday numbers Mon=1..Sun=7), parsed with
    // parseMeetingDays (src/lib/services/classSessions.ts). Null when cadence
    // doesn't need a weekday set (daily/after_class/before_class).
    byWeekday: text('by_weekday'),
    courseId: text('course_id').references(() => courses.id, { onDelete: 'cascade' }),
    // JSON array of {kind: 'game'|'warmup'|'retrieval'|'new_material'|'reflect'|'break', label?, minutes?}
    // — a guidance step rail for session_shape/both rituals, not enforced
    // gates (see StudyFlow.svelte). Null for plain recurring rituals with no
    // in-session structure.
    steps: text('steps', { mode: 'json' }),
    // Reserved for a future group scope — no FK (groups don't exist yet).
    // Always null in v1.
    groupId: text('group_id'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [index('rituals_user_id_idx').on(table.userId)],
);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const tasks = sqliteTable(
  'tasks',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    dueDate: integer('due_date'),
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    // v1.4: 'todo' is the only type a user can mint directly (createTaskSchema
    // has no `type` field); the rest are sweep-generated only — see
    // services/taskSweep.ts and the TASK_TYPES doc comment.
    type: text('type', { enum: TASK_TYPES }).notNull().default('todo'),
    // One level of subtasks: a parent must not itself have a parent
    // (enforced in services/tasks.ts). Cascade so deleting a parent deletes
    // its children.
    parentTaskId: text('parent_task_id').references((): AnySQLiteColumn => tasks.id, { onDelete: 'cascade' }),
    completedAt: integer('completed_at'),
    // v1.6: optional short recap the user can attach when completing any
    // task (not just attend_class) — wired through
    // toggleTask(id, {completionNote}) and PATCH /tasks/:id's
    // `completion_note`. Independent of `description`; never required.
    completionNote: text('completion_note'),
    // System-task soft delete (user dismissal). NEVER serialized — a
    // dismissed row stays in the table (with its dedupe key) purely so the
    // sweep can't resurrect it. Retention-purged after 120d, see taskSweep.ts.
    dismissedAt: integer('dismissed_at'),
    // Origin FKs for sweep-generated tasks — null for user-minted todos.
    courseId: text('course_id').references(() => courses.id, { onDelete: 'cascade' }),
    classSessionId: text('class_session_id').references(() => classSessions.id, { onDelete: 'cascade' }),
    assessmentId: text('assessment_id').references(() => assessments.id, { onDelete: 'cascade' }),
    kcId: text('kc_id').references(() => kcs.id, { onDelete: 'cascade' }),
    // v1.9: origin FK for sweep-generated 'ritual' tasks — see
    // services/taskSweep.ts::collectRituals.
    ritualId: text('ritual_id').references(() => rituals.id, { onDelete: 'cascade' }),
    // Idempotency key for sweep-generated rows, e.g. `attend_class:<id>`.
    // Unique-indexed below; NULL (all user tasks) is unconstrained under
    // SQLite's multi-NULL unique semantics. Never serialized.
    dedupeKey: text('dedupe_key'),
    // 'system' is reserved for future system-generated tasks (e.g. from the
    // notifications sweep); nothing produces those yet in v1.1.
    source: text('source', { enum: ['user', 'system'] }).notNull().default('user'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('tasks_dedupe_key_unique').on(table.dedupeKey),
    // Real callers filter eq(userId) AND isNull(dismissedAt) then order/range
    // on dueDate; none constrains `done` — see services/tasks.ts, calendar.ts.
    index('tasks_user_dismissed_due_idx').on(table.userId, table.dismissedAt, table.dueDate),
    index('tasks_parent_idx').on(table.parentTaskId),
  ],
);

export const taskCourses = sqliteTable(
  'task_courses',
  {
    id: id(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('task_courses_task_course_unique').on(table.taskId, table.courseId)],
);

// ---------------------------------------------------------------------------
// Resources (feed)
// ---------------------------------------------------------------------------

export const resources = sqliteTable('resources', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  label: text('label').notNull(),
  kind: text('kind', { enum: ['canonical', 'feed', 'user_shared'] }).notNull(),
  courseId: text('course_id').references(() => courses.id, { onDelete: 'set null' }),
  kcId: text('kc_id').references(() => kcs.id, { onDelete: 'set null' }),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  addedBy: text('added_by'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Study sessions
// ---------------------------------------------------------------------------

export const studySessions = sqliteTable(
  'study_sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: text('course_id').references(() => courses.id, { onDelete: 'set null' }),
    intendedEventType: text('intended_event_type').notNull(),
    plannedMinutes: integer('planned_minutes'),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    scheduledAt: integer('scheduled_at'),
    reflection: text('reflection'),
    // v1.9: session-shape ritual adherence signal — see rituals table and
    // services/rituals.ts::listRitualsWithAdherence.
    ritualId: text('ritual_id').references(() => rituals.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    // calendar.ts assembles date-range views by filtering userId +
    // coalesce(scheduledAt, startedAt); SQLite can't index the coalesce, so
    // these two composites let either side of it be served by an index.
    index('study_sessions_user_scheduled_idx').on(table.userId, table.scheduledAt),
    index('study_sessions_user_started_idx').on(table.userId, table.startedAt),
  ],
);

export const sessionKcs = sqliteTable(
  'session_kcs',
  {
    id: id(),
    studySessionId: text('study_session_id')
      .notNull()
      .references(() => studySessions.id, { onDelete: 'cascade' }),
    kcId: text('kc_id')
      .notNull()
      .references(() => kcs.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('session_kcs_session_kc_unique').on(table.studySessionId, table.kcId)],
);

// One terminal command per ordinary study session. The primary key is the
// concurrency guard: completion/discard and every event/mastery consequence
// join the same D1 batch, so a losing finalization race rolls back wholesale.
export const studySessionFinalizations = sqliteTable('study_session_finalizations', {
  studySessionId: text('study_session_id')
    .primaryKey()
    .references(() => studySessions.id, { onDelete: 'cascade' }),
  disposition: text('disposition', { enum: ['completed', 'discarded'] }).notNull(),
  finalizedAt: integer('finalized_at').notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Tutor
// ---------------------------------------------------------------------------

export const tutorConversations = sqliteTable('tutor_conversations', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kcId: text('kc_id')
    .notNull()
    .references(() => kcs.id, { onDelete: 'cascade' }),
  mode: text('mode', {
    enum: ['recall', 'classify', 'worked_example', 'self_explain', 'interactive_model', 'absorb'],
  }).notNull(),
  // v1.7: carries flow-specific extras, e.g. { flow: 'absorb', focus_order:
  // [kcId, ...] } for an absorb conversation's prereq traversal order.
  details: text('details', { mode: 'json' })
    .notNull()
    .default(sql`'{}'`),
  createdAt: createdAt(),
});

export const tutorMessages = sqliteTable('tutor_messages', {
  id: id(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => tutorConversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  createdAt: createdAt(),
});

// v1.7: a user's accepted-correction ledger — entries created when a tutor's
// correction_proposal (absorb flow) is accepted, or manually. No FK-required
// kc_id/misconception_id (both nullable, set-null) since a correction can be
// freeform (no specific misconception matched).
export const userCorrections = sqliteTable(
  'user_corrections',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kcId: text('kc_id').references(() => kcs.id, { onDelete: 'set null' }),
    misconceptionId: text('misconception_id').references(() => misconceptions.id, { onDelete: 'set null' }),
    priorBelief: text('prior_belief'),
    correction: text('correction').notNull(),
    status: text('status', { enum: ['active', 'internalized'] }).notNull().default('active'),
    acceptedAt: integer('accepted_at').notNull(),
    // Conversation state is now owned by the per-learner Durable Object. This
    // remains an opaque provenance id so legacy D1 transcripts and new DO
    // transcripts can both be referenced without coupling learner state back
    // into D1.
    sourceConversationId: text('source_conversation_id'),
    lastRemindedAt: integer('last_reminded_at'),
    createdAt: createdAt(),
  },
  (table) => [index('user_corrections_user_status_idx').on(table.userId, table.status)],
);

// Per-learner state for a seeded misconception. The correction ledger remains
// the learner-facing record of what was corrected; this table is the
// deterministic lifecycle state that exercise diagnostics and corrections
// advance. Evidence ids are retained as JSON because one lifecycle row may be
// supported by several diagnostic probes while the design intentionally adds
// only this one persistence table.
export const userMisconceptions = sqliteTable(
  'user_misconceptions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    misconceptionId: text('misconception_id')
      .notNull()
      .references(() => misconceptions.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['suspected', 'confirmed', 'correcting', 'internalized'] }).notNull(),
    evidenceEventIds: text('evidence_event_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    suspectedAt: integer('suspected_at'),
    confirmedAt: integer('confirmed_at'),
    correctingAt: integer('correcting_at'),
    internalizedAt: integer('internalized_at'),
    createdAt: createdAt(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('user_misconceptions_user_misconception_unique').on(table.userId, table.misconceptionId),
    index('user_misconceptions_user_status_idx').on(table.userId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Notifications (v1.1)
// ---------------------------------------------------------------------------

export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: ['assessment_due', 'task_overdue', 'kc_review', 'session_unfinished', 'grade_recorded', 'correction_review'],
    }).notNull(),
    title: text('title').notNull(),
    body: text('body'),
    courseId: text('course_id').references(() => courses.id, { onDelete: 'set null' }),
    href: text('href').notNull(),
    // Sweep-generated notifications are idempotent via ON CONFLICT DO NOTHING
    // keyed on this — e.g. `assessment_due:<id>`, `task_overdue:<id>:<dueDate>`.
    dedupeKey: text('dedupe_key').notNull().unique(),
    readAt: integer('read_at'),
    createdAt: createdAt(),
  },
  (table) => [index('notifications_user_read_created_idx').on(table.userId, table.readAt, table.createdAt)],
);

// ---------------------------------------------------------------------------
// Class sessions (v1.3) — attendance re-modeled: pre-existing scheduled rows
// whose status gets updated, not events appended by button clicks. Rows are
// generated by an idempotent sweep (see services/classSessions.ts) from
// `courses.meetingDays`, one per meeting-day date; the events API is no
// longer the attendance mechanism.
// ---------------------------------------------------------------------------

export const classSessions = sqliteTable(
  'class_sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    // Epoch ms at LOCAL NOON of the class day — noon avoids a TZ day-shift
    // when converting to/from ISO at the API boundary.
    date: integer('date').notNull(),
    // NULL = unmarked (the student hasn't recorded attendance yet).
    status: text('status', { enum: ['attended', 'missed'] }),
    note: text('note'),
    source: text('source', { enum: ['schedule', 'manual', 'seed'] }).notNull().default('schedule'),
    // v1.6: minutes-from-midnight (0-1439) of the class day, for a session
    // with a concrete meeting time. NULL for both — sweep-generated
    // ('schedule') rows always keep these null (all-day semantics
    // unchanged); only 'manual'/'seed' rows may set them. Powers
    // getCalendar's `class_session` timed item (services/calendar.ts) —
    // emitted only when both are non-null.
    startMin: integer('start_min'),
    endMin: integer('end_min'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('class_sessions_course_date_unique').on(table.courseId, table.date)],
);

// ---------------------------------------------------------------------------
// Calendar integrations
// ---------------------------------------------------------------------------

export const calendarConnections = sqliteTable(
  'calendar_connections',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['google', 'microsoft'] }).notNull(),
    externalAccountId: text('external_account_id').notNull(),
    syncMode: text('sync_mode', { enum: ['read', 'controlled'] }).notNull().default('controlled'),
    status: text('status', { enum: ['active', 'reconnect_required', 'disconnected'] }).notNull().default('active'),
    lastError: text('last_error'),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('calendar_connections_user_provider_account_unique').on(table.userId, table.provider, table.externalAccountId),
    index('calendar_connections_user_status_idx').on(table.userId, table.status),
  ],
);

export const calendarProviderCalendars = sqliteTable(
  'calendar_provider_calendars',
  {
    id: id(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => calendarConnections.id, { onDelete: 'cascade' }),
    providerCalendarId: text('provider_calendar_id').notNull(),
    name: text('name').notNull(),
    timezone: text('timezone'),
    selected: integer('selected', { mode: 'boolean' }).notNull().default(false),
    studyusOwned: integer('studyus_owned', { mode: 'boolean' }).notNull().default(false),
    accessRole: text('access_role'),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('calendar_provider_calendars_connection_remote_unique').on(table.connectionId, table.providerCalendarId),
    index('calendar_provider_calendars_connection_selected_idx').on(table.connectionId, table.selected),
  ],
);

export const calendarSyncStates = sqliteTable(
  'calendar_sync_states',
  {
    id: id(),
    providerCalendarId: text('provider_calendar_id')
      .notNull()
      .references(() => calendarProviderCalendars.id, { onDelete: 'cascade' }),
    cursor: text('cursor'),
    webhookChannelId: text('webhook_channel_id'),
    webhookResourceId: text('webhook_resource_id'),
    webhookExpiresAt: integer('webhook_expires_at'),
    lastSyncedAt: integer('last_synced_at'),
    lastError: text('last_error'),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('calendar_sync_states_calendar_unique').on(table.providerCalendarId)],
);

export const calendarExternalEvents = sqliteTable(
  'calendar_external_events',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerCalendarId: text('provider_calendar_id')
      .notNull()
      .references(() => calendarProviderCalendars.id, { onDelete: 'cascade' }),
    providerEventId: text('provider_event_id').notNull(),
    providerVersion: text('provider_version'),
    iCalUid: text('ical_uid'),
    recurringEventId: text('recurring_event_id'),
    title: text('title').notNull().default('Busy'),
    // Null is allowed only for a provider deletion tombstone that arrives
    // before the corresponding event was ever materialized locally.
    startKind: text('start_kind', { enum: ['timed', 'date'] }),
    startAt: integer('start_at'),
    startDate: text('start_date'),
    endAt: integer('end_at'),
    endDate: text('end_date'),
    timezone: text('timezone'),
    busyStatus: text('busy_status', { enum: ['free', 'tentative', 'busy', 'out_of_office'] }).notNull().default('busy'),
    status: text('status', { enum: ['confirmed', 'tentative', 'cancelled'] }).notNull().default('confirmed'),
    recurrence: text('recurrence', { mode: 'json' }),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('calendar_external_events_calendar_remote_unique').on(table.providerCalendarId, table.providerEventId),
    index('calendar_external_events_user_start_idx').on(table.userId, table.startAt),
    index('calendar_external_events_user_start_date_idx').on(table.userId, table.startDate),
  ],
);

export const calendarEventLinks = sqliteTable(
  'calendar_event_links',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerCalendarId: text('provider_calendar_id')
      .notNull()
      .references(() => calendarProviderCalendars.id, { onDelete: 'cascade' }),
    providerEventId: text('provider_event_id').notNull(),
    localEntityType: text('local_entity_type', { enum: ['study_session', 'task', 'assessment', 'class_session'] }).notNull(),
    localEntityId: text('local_entity_id').notNull(),
    providerVersion: text('provider_version'),
    lastSyncedAt: integer('last_synced_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('calendar_event_links_calendar_remote_unique').on(table.providerCalendarId, table.providerEventId),
    uniqueIndex('calendar_event_links_calendar_local_unique').on(table.providerCalendarId, table.localEntityType, table.localEntityId),
    index('calendar_event_links_user_local_idx').on(table.userId, table.localEntityType, table.localEntityId),
  ],
);

export const calendarOutbox = sqliteTable(
  'calendar_outbox',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => calendarConnections.id, { onDelete: 'cascade' }),
    action: text('action', { enum: ['upsert', 'delete'] }).notNull(),
    entityType: text('entity_type', { enum: ['study_session', 'task', 'assessment', 'class_session'] }).notNull(),
    entityId: text('entity_id').notNull(),
    revision: text('revision').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status', { enum: ['pending', 'processing', 'done', 'failed'] }).notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    availableAt: integer('available_at').notNull().$defaultFn(() => Date.now()),
    lastError: text('last_error'),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('calendar_outbox_dedupe_key_unique').on(table.dedupeKey),
    index('calendar_outbox_status_available_idx').on(table.status, table.availableAt),
  ],
);

export const calendarFeedCredentials = sqliteTable(
  'calendar_feed_credentials',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    revokedAt: integer('revoked_at'),
    updatedAt: integer('updated_at')
      .notNull()
      .$defaultFn(() => Date.now()),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('calendar_feed_credentials_user_unique').on(table.userId),
    uniqueIndex('calendar_feed_credentials_hash_unique').on(table.tokenHash),
  ],
);
