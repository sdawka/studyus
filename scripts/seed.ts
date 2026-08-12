// Idempotent seed script: reads courses/courses.json and upserts
// courses -> branches -> kcs (concepts), canonical/feed links -> resources,
// and a single seeded user from SEED_USER_EMAIL/SEED_USER_PASSWORD.
//
// Runs outside the Workers runtime (plain Node + tsx), so it shells out to
// `wrangler d1 execute --local` with generated SQL rather than importing the
// Workers-only `cloudflare:workers` module or drizzle's D1 driver directly.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EVENT_ROLE_FLAGS } from '../src/lib/schemas/events';

const DAY_MS = 24 * 60 * 60 * 1000;

type CourseConcept = {
  name: string;
  confidence: number;
  practice: string;
  notes: string;
  status: string;
};

type CourseBranch = {
  branch: string;
  concepts: CourseConcept[];
};

type CourseLink = { label: string; url: string };

type CourseJson = {
  code: string;
  slug: string;
  title: string;
  credits: number;
  term: string;
  instructor: string;
  prereqs: string;
  source: string;
  overview: string;
  canonical: CourseLink[];
  branches: CourseBranch[];
  feed: CourseLink[];
};

// Override map: KLI kc_type for concepts that are obviously not plain "concept"s.
const KC_TYPE_OVERRIDES: Record<string, 'rule' | 'principle'> = {
  'Separation of variables': 'rule',
  'Rate laws': 'rule',
  'Bernoulli equation': 'principle',
  "Bernoulli's equation": 'principle',
  'Navier-Stokes equations': 'principle',
};

function kcTypeFor(name: string): 'concept' | 'rule' | 'principle' {
  return KC_TYPE_OVERRIDES[name] ?? 'concept';
}

function sqlStr(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function pbkdf2Hash(password: string): Promise<string> {
  const crypto = globalThis.crypto;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100_000;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  const toHex = (buf: ArrayBuffer | Uint8Array) =>
    [...new Uint8Array(buf as ArrayBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$${iterations}$${toHex(salt.buffer)}$${toHex(derived)}`;
}

async function main() {
  const isRemote = process.argv.includes('--remote');
  const dbFlag = isRemote ? '--remote' : '--local';

  const coursesPath = join(process.cwd(), 'courses', 'courses.json');
  const coursesData: CourseJson[] = JSON.parse(readFileSync(coursesPath, 'utf-8'));

  const seedEmail = process.env.SEED_USER_EMAIL || 'student@example.com';
  const seedPassword = process.env.SEED_USER_PASSWORD || 'studyus';
  const passwordHash = await pbkdf2Hash(seedPassword);
  const userId = deterministicId('user', seedEmail);
  const now = Date.now();

  const statements: string[] = [];

  // --- user (upsert by email) ---
  // current_term determines which courses the demo data block (below) treats
  // as "in progress" — kept in sync with the courses.json term string that's
  // actually current relative to the other terms in that file.
  const CURRENT_TERM = 'Winter 2025';
  statements.push(
    `INSERT INTO users (id, email, password_hash, name, current_term, settings, onboarded_at, created_at)
     VALUES (${sqlStr(userId)}, ${sqlStr(seedEmail)}, ${sqlStr(passwordHash)}, ${sqlStr('Student')}, ${sqlStr(CURRENT_TERM)}, '{}', NULL, ${Date.now()})
     ON CONFLICT(email) DO UPDATE SET current_term=excluded.current_term;`,
  );

  // Per-course accent hue (OKLCH H, 0-360): a spaced list so adjacent courses
  // in a term don't land on visually similar hues, assigned by list index.
  const COURSE_HUES = [235, 25, 150, 305, 65, 190, 340, 105, 45];

  // Populated per-course below; feeds the demo data block after the main loop.
  const currentTermCourses: { id: string; slug: string; meetingDays: number[] | null; kcs: { id: string; name: string }[] }[] = [];

  // Varied meeting-day patterns (Mon=1..Sun=7) cycled across the current-term
  // demo courses so the class sessions sweep has something realistic to
  // generate for each of them.
  const MEETING_DAY_PATTERNS: number[][] = [[1, 3], [2, 4], [1, 3, 5], [2, 5]];

  for (const [courseIdx, course] of coursesData.entries()) {
    const courseId = deterministicId('course', course.slug);
    const colorHue = COURSE_HUES[courseIdx % COURSE_HUES.length];
    const isCurrentTerm = course.term.includes(CURRENT_TERM);
    const meetingDays = isCurrentTerm ? MEETING_DAY_PATTERNS[currentTermCourses.length % MEETING_DAY_PATTERNS.length] : null;
    statements.push(
      `INSERT INTO courses (id, user_id, code, slug, title, credits, term, instructor, prereqs, overview, source_url, color, meeting_days, archived, created_at)
       VALUES (${sqlStr(courseId)}, ${sqlStr(userId)}, ${sqlStr(course.code)}, ${sqlStr(course.slug)}, ${sqlStr(course.title)}, ${sqlStr(course.credits)}, ${sqlStr(course.term)}, ${sqlStr(course.instructor)}, ${sqlStr(course.prereqs)}, ${sqlStr(course.overview)}, ${sqlStr(course.source)}, ${sqlStr(colorHue)}, ${sqlStr(meetingDays ? JSON.stringify(meetingDays) : null)}, 0, ${Date.now()})
       ON CONFLICT(slug) DO UPDATE SET
         code=excluded.code, title=excluded.title, credits=excluded.credits, term=excluded.term,
         instructor=excluded.instructor, prereqs=excluded.prereqs, overview=excluded.overview, source_url=excluded.source_url, color=excluded.color, meeting_days=excluded.meeting_days;`,
    );

    const courseKcs: { id: string; name: string }[] = [];

    (course.branches || []).forEach((branch, branchIdx) => {
      const branchId = deterministicId('branch', `${course.slug}:${branch.branch}`);
      statements.push(
        `INSERT INTO branches (id, course_id, name, sort_order, created_at)
         VALUES (${sqlStr(branchId)}, ${sqlStr(courseId)}, ${sqlStr(branch.branch)}, ${branchIdx}, ${Date.now()})
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order;`,
      );

      (branch.concepts || []).forEach((concept, conceptIdx) => {
        const kcId = deterministicId('kc', `${course.slug}:${branch.branch}:${concept.name}`);
        const kcType = kcTypeFor(concept.name);
        statements.push(
          `INSERT INTO kcs (id, branch_id, course_id, name, kc_type, description, practice_notes, sort_order, mastery, status, last_event_at, created_at)
           VALUES (${sqlStr(kcId)}, ${sqlStr(branchId)}, ${sqlStr(courseId)}, ${sqlStr(concept.name)}, ${sqlStr(kcType)}, NULL, ${sqlStr(concept.practice || null)}, ${conceptIdx}, ${sqlStr(concept.confidence || 0)}, ${sqlStr(concept.status || 'not-started')}, NULL, ${Date.now()})
           ON CONFLICT(id) DO UPDATE SET
             name=excluded.name, kc_type=excluded.kc_type, practice_notes=excluded.practice_notes, sort_order=excluded.sort_order;`,
        );
        courseKcs.push({ id: kcId, name: concept.name });
      });
    });

    (course.canonical || []).forEach((link) => {
      const resourceId = deterministicId('resource', `canonical:${course.slug}:${link.url}`);
      statements.push(
        `INSERT INTO resources (id, user_id, url, label, kind, course_id, kc_id, pinned, added_by, created_at)
         VALUES (${sqlStr(resourceId)}, ${sqlStr(userId)}, ${sqlStr(link.url)}, ${sqlStr(link.label)}, 'canonical', ${sqlStr(courseId)}, NULL, 0, ${sqlStr('seed')}, ${Date.now()})
         ON CONFLICT(id) DO UPDATE SET label=excluded.label;`,
      );
    });

    (course.feed || []).forEach((link) => {
      const resourceId = deterministicId('resource', `feed:${course.slug}:${link.url}`);
      statements.push(
        `INSERT INTO resources (id, user_id, url, label, kind, course_id, kc_id, pinned, added_by, created_at)
         VALUES (${sqlStr(resourceId)}, ${sqlStr(userId)}, ${sqlStr(link.url)}, ${sqlStr(link.label)}, 'feed', ${sqlStr(courseId)}, NULL, 0, ${sqlStr('seed')}, ${Date.now()})
         ON CONFLICT(id) DO UPDATE SET label=excluded.label;`,
      );
    });

    if (isCurrentTerm) {
      currentTermCourses.push({ id: courseId, slug: course.slug, meetingDays, kcs: courseKcs });
    }
  }

  // ---------------------------------------------------------------------
  // Demo data (v1.2): assessments/tasks/events/study sessions for the
  // current-term courses only, so the planner/dashboard have something
  // realistic to render. Idempotent — all ids are deterministic and every
  // insert is ON CONFLICT DO UPDATE, so dates refresh (relative to `now`)
  // on every seed run instead of accumulating duplicates.
  const ASSESSMENT_TITLES = {
    past: ['Midterm 1', 'Term Test 1', 'Quiz 3'],
    near: ['Assignment 3', 'Problem Set 4', 'Lab report 2'],
    far: ['Lab report 2', 'Assignment 5', 'Midterm 2'],
  };

  currentTermCourses.forEach(({ id: courseId, slug }, courseIdx) => {
    const pastDue = now - 10 * DAY_MS;
    const nearDue = now + (2 + (courseIdx % 8)) * DAY_MS; // 2-9 days out
    const farDue = now + (15 + (courseIdx % 7)) * DAY_MS; // 15-21 days out
    const gradePct = 72 + ((courseIdx * 5) % 17); // 72-88%

    const pastId = deterministicId('assessment', `demo:${slug}:past`);
    const nearId = deterministicId('assessment', `demo:${slug}:near`);
    const farId = deterministicId('assessment', `demo:${slug}:far`);

    statements.push(
      `INSERT INTO assessments (id, course_id, title, type, due_date, weight_pct, grade_received, grade_max, created_at)
       VALUES (${sqlStr(pastId)}, ${sqlStr(courseId)}, ${sqlStr(ASSESSMENT_TITLES.past[courseIdx % ASSESSMENT_TITLES.past.length])}, 'midterm', ${pastDue}, 20, ${gradePct}, 100, ${now})
       ON CONFLICT(id) DO UPDATE SET due_date=excluded.due_date, grade_received=excluded.grade_received;`,
      `INSERT INTO assessments (id, course_id, title, type, due_date, weight_pct, grade_received, grade_max, created_at)
       VALUES (${sqlStr(nearId)}, ${sqlStr(courseId)}, ${sqlStr(ASSESSMENT_TITLES.near[courseIdx % ASSESSMENT_TITLES.near.length])}, 'assignment', ${nearDue}, 10, NULL, 100, ${now})
       ON CONFLICT(id) DO UPDATE SET due_date=excluded.due_date;`,
      `INSERT INTO assessments (id, course_id, title, type, due_date, weight_pct, grade_received, grade_max, created_at)
       VALUES (${sqlStr(farId)}, ${sqlStr(courseId)}, ${sqlStr(ASSESSMENT_TITLES.far[courseIdx % ASSESSMENT_TITLES.far.length])}, 'lab', ${farDue}, 15, NULL, 100, ${now})
       ON CONFLICT(id) DO UPDATE SET due_date=excluded.due_date;`,
    );
  });

  // --- tasks (6 total, spread across current-term courses; 2 linked) ---
  const TASK_SPECS: { title: string; dueOffsetDays: number; done: boolean }[] = [
    { title: 'Submit lab report', dueOffsetDays: -2, done: false }, // overdue
    { title: 'Finish problem set', dueOffsetDays: 1, done: false },
    { title: 'Read chapter 7', dueOffsetDays: 3, done: false },
    { title: 'Prepare tutorial questions', dueOffsetDays: 6, done: false },
    { title: 'Start final project outline', dueOffsetDays: 12, done: false },
    { title: 'Review midterm material', dueOffsetDays: 18, done: false },
  ];

  TASK_SPECS.forEach((spec, i) => {
    const taskId = deterministicId('task', `demo-task-${i + 1}`);
    const dueDate = now + spec.dueOffsetDays * DAY_MS;
    statements.push(
      `INSERT INTO tasks (id, user_id, title, due_date, done, source, created_at)
       VALUES (${sqlStr(taskId)}, ${sqlStr(userId)}, ${sqlStr(spec.title)}, ${dueDate}, ${spec.done}, 'user', ${now})
       ON CONFLICT(id) DO UPDATE SET due_date=excluded.due_date, title=excluded.title, done=excluded.done;`,
    );

    // Link the first two tasks to a current-term course so the calendar's
    // task_due items resolve a course_id.
    if (i < 2 && currentTermCourses.length) {
      const linkedCourse = currentTermCourses[i % currentTermCourses.length];
      const linkId = deterministicId('taskcourse', `demo-task-${i + 1}:${linkedCourse.id}`);
      statements.push(
        `INSERT INTO task_courses (id, task_id, course_id)
         VALUES (${sqlStr(linkId)}, ${sqlStr(taskId)}, ${sqlStr(linkedCourse.id)})
         ON CONFLICT(id) DO NOTHING;`,
      );
    }
  });

  // --- logged events (~12 over the past 14 days, across courses/KCs) ---
  const EVENT_TYPE_POOL = ['lecture_attended', 'reading_done', 'practice_done', 'quiz_taken'] as const;
  const coursesWithKcs = currentTermCourses.filter((c) => c.kcs.length > 0);

  if (coursesWithKcs.length) {
    for (let i = 0; i < 12; i++) {
      const course = coursesWithKcs[i % coursesWithKcs.length];
      const kc = course.kcs[i % course.kcs.length];
      const type = EVENT_TYPE_POOL[i % EVENT_TYPE_POOL.length];
      const flags = EVENT_ROLE_FLAGS[type];
      const daysAgo = 1 + ((i * 3) % 14); // spread across the past 14 days
      const ts = now - daysAgo * DAY_MS;
      const isAssessmentType = type === 'practice_done' || type === 'quiz_taken';
      const payload = isAssessmentType ? { correct: i % 3 !== 0 } : {};
      const eventId = deterministicId('event', `demo-event-${i + 1}`);

      statements.push(
        `INSERT INTO events (id, user_id, ts, type, is_instructional, is_assessment, kc_id, course_id, session_id, payload, source, created_at)
         VALUES (${sqlStr(eventId)}, ${sqlStr(userId)}, ${ts}, ${sqlStr(type)}, ${sqlStr(flags.isInstructional)}, ${sqlStr(flags.isAssessment)}, ${sqlStr(kc.id)}, ${sqlStr(course.id)}, NULL, ${sqlStr(JSON.stringify(payload))}, 'seed', ${now})
         ON CONFLICT(id) DO UPDATE SET ts=excluded.ts, payload=excluded.payload;`,
      );
    }
  }

  // --- study sessions (3 completed in the past week, 2 scheduled ahead) ---
  function atLocalTime(dayOffset: number, hour: number, minute = 0): number {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  }

  if (currentTermCourses.length) {
    const completedSpecs = [
      { dayOffset: -1, hour: 18, minutes: 60 },
      { dayOffset: -3, hour: 19, minutes: 75 },
      { dayOffset: -5, hour: 20, minutes: 90 },
    ];
    completedSpecs.forEach((spec, i) => {
      const course = currentTermCourses[i % currentTermCourses.length];
      const sessionId = deterministicId('session', `demo-session-completed-${i + 1}`);
      const startedAt = atLocalTime(spec.dayOffset, spec.hour);
      const endedAt = startedAt + spec.minutes * 60_000;
      statements.push(
        `INSERT INTO study_sessions (id, user_id, course_id, intended_event_type, planned_minutes, started_at, ended_at, scheduled_at, reflection, created_at)
         VALUES (${sqlStr(sessionId)}, ${sqlStr(userId)}, ${sqlStr(course.id)}, 'practice_done', ${spec.minutes}, ${startedAt}, ${endedAt}, NULL, ${sqlStr('Worked through practice problems and reviewed weak spots.')}, ${now})
         ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at, ended_at=excluded.ended_at;`,
      );
    });

    const scheduledSpecs = [
      { dayOffset: 2, hour: 17, minutes: 60 },
      { dayOffset: 5, hour: 19, minutes: 90 },
    ];
    scheduledSpecs.forEach((spec, i) => {
      const course = currentTermCourses[(i + completedSpecs.length) % currentTermCourses.length];
      const sessionId = deterministicId('session', `demo-session-scheduled-${i + 1}`);
      const scheduledAt = atLocalTime(spec.dayOffset, spec.hour);
      statements.push(
        `INSERT INTO study_sessions (id, user_id, course_id, intended_event_type, planned_minutes, started_at, ended_at, scheduled_at, reflection, created_at)
         VALUES (${sqlStr(sessionId)}, ${sqlStr(userId)}, ${sqlStr(course.id)}, 'practice_done', ${spec.minutes}, ${scheduledAt}, NULL, ${scheduledAt}, NULL, ${now})
         ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at, scheduled_at=excluded.scheduled_at, planned_minutes=excluded.planned_minutes;`,
      );
    });
  }

  // --- class sessions (v1.3): past ~4 weeks of scheduled sessions per
  // current-term course, matching its meeting_days pattern above. Statuses
  // are deterministic (hashed from the session's own id, not Math.random)
  // so re-seeding is stable: ~80% attended, ~10% missed, ~10% unmarked —
  // except the most recent 1-2 sessions per course, always forced to
  // unmarked so the UI's "mark attendance" call-to-action always has
  // something to act on.
  const CLASS_SESSION_WINDOW_DAYS = 28;

  function localNoonDaysAgo(daysAgo: number): number {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  }

  function isoWeekdayOf(noonMs: number): number {
    const dow = new Date(noonMs).getDay();
    return dow === 0 ? 7 : dow;
  }

  function yyyymmdd(ms: number): string {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  // Stable hash -> [0, 1) fraction, used only to pick a deterministic demo
  // status; same hash shape as deterministicId but returns a fraction.
  function hashFraction(key: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
    }
    h = (h ^ (h >>> 16)) >>> 0;
    return (h % 10_000) / 10_000;
  }

  currentTermCourses.forEach(({ id: courseId, slug, meetingDays }) => {
    if (!meetingDays || meetingDays.length === 0) return;

    const sessionDates: number[] = [];
    for (let daysAgo = CLASS_SESSION_WINDOW_DAYS; daysAgo >= 0; daysAgo--) {
      const noon = localNoonDaysAgo(daysAgo);
      if (meetingDays.includes(isoWeekdayOf(noon))) sessionDates.push(noon);
    }

    sessionDates.forEach((dateMs, idx) => {
      const key = `demo-csess-${slug}-${yyyymmdd(dateMs)}`;
      const sessionId = deterministicId('csess', key);
      const isMostRecent = idx >= sessionDates.length - 2;

      let status: 'attended' | 'missed' | null;
      if (isMostRecent) {
        status = null;
      } else {
        const frac = hashFraction(key);
        status = frac < 0.8 ? 'attended' : frac < 0.9 ? 'missed' : null;
      }

      statements.push(
        `INSERT INTO class_sessions (id, user_id, course_id, date, status, note, source, created_at)
         VALUES (${sqlStr(sessionId)}, ${sqlStr(userId)}, ${sqlStr(courseId)}, ${dateMs}, ${sqlStr(status)}, NULL, 'seed', ${now})
         ON CONFLICT(id) DO NOTHING;`,
      );
    });
  });

  const dir = mkdtempSync(join(tmpdir(), 'studyus-seed-'));
  const sqlPath = join(dir, 'seed.sql');
  writeFileSync(sqlPath, statements.join('\n'));

  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'studyus', dbFlag, '--file', sqlPath],
    { stdio: 'inherit' },
  );

  console.log(`Seeded ${coursesData.length} courses (user: ${seedEmail}).`);
}

// Deterministic UUID-shaped id derived from a stable key, so re-running the
// seed script upserts the same rows instead of creating duplicates.
function deterministicId(namespace: string, key: string): string {
  const input = `${namespace}:${key}`;
  // Simple stable hash -> hex, reshaped into a UUID-like string. Not
  // cryptographically meaningful; just needs to be stable and unique.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  const hex = h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  const padded = (hex + hex).slice(0, 32);
  return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
