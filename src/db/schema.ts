import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  currentTerm: text('current_term'),
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

// ---------------------------------------------------------------------------
// Courses / branches / KCs
// ---------------------------------------------------------------------------

export const courses = sqliteTable('courses', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  credits: integer('credits'),
  term: text('term'),
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
  createdAt: createdAt(),
});

export const branches = sqliteTable('branches', {
  id: id(),
  courseId: text('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

// KLI taxonomy: fact | association | concept | rule | principle
export const kcs = sqliteTable('kcs', {
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
  sortOrder: integer('sort_order').notNull().default(0),
  // Derived caches, recomputed on every event write.
  mastery: integer('mastery').notNull().default(0), // 0-100
  status: text('status').notNull().default('not-started'),
  lastEventAt: integer('last_event_at'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Events — the source of truth for mastery
// ---------------------------------------------------------------------------

export const events = sqliteTable('events', {
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
  source: text('source', { enum: ['manual', 'session', 'tutor', 'seed'] }).notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Assessments & grades
// ---------------------------------------------------------------------------

export const assessments = sqliteTable('assessments', {
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
});

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
// Tasks
// ---------------------------------------------------------------------------

export const tasks = sqliteTable('tasks', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  dueDate: integer('due_date'),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  // 'system' is reserved for future system-generated tasks (e.g. from the
  // notifications sweep); nothing produces those yet in v1.1.
  source: text('source', { enum: ['user', 'system'] }).notNull().default('user'),
  createdAt: createdAt(),
});

export const taskCourses = sqliteTable('task_courses', {
  id: id(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  courseId: text('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
});

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

export const studySessions = sqliteTable('study_sessions', {
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
  createdAt: createdAt(),
});

export const sessionKcs = sqliteTable('session_kcs', {
  id: id(),
  studySessionId: text('study_session_id')
    .notNull()
    .references(() => studySessions.id, { onDelete: 'cascade' }),
  kcId: text('kc_id')
    .notNull()
    .references(() => kcs.id, { onDelete: 'cascade' }),
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
    enum: ['recall', 'classify', 'worked_example', 'self_explain', 'interactive_model'],
  }).notNull(),
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
      enum: ['assessment_due', 'task_overdue', 'kc_review', 'session_unfinished', 'grade_recorded'],
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
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('class_sessions_course_date_unique').on(table.courseId, table.date)],
);
