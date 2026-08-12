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

  const statements: string[] = [];

  // --- user (upsert by email) ---
  statements.push(
    `INSERT INTO users (id, email, password_hash, name, current_term, settings, onboarded_at, created_at)
     VALUES (${sqlStr(userId)}, ${sqlStr(seedEmail)}, ${sqlStr(passwordHash)}, ${sqlStr('Student')}, NULL, '{}', NULL, ${Date.now()})
     ON CONFLICT(email) DO NOTHING;`,
  );

  for (const course of coursesData) {
    const courseId = deterministicId('course', course.slug);
    statements.push(
      `INSERT INTO courses (id, user_id, code, slug, title, credits, term, instructor, prereqs, overview, source_url, color, archived, created_at)
       VALUES (${sqlStr(courseId)}, ${sqlStr(userId)}, ${sqlStr(course.code)}, ${sqlStr(course.slug)}, ${sqlStr(course.title)}, ${sqlStr(course.credits)}, ${sqlStr(course.term)}, ${sqlStr(course.instructor)}, ${sqlStr(course.prereqs)}, ${sqlStr(course.overview)}, ${sqlStr(course.source)}, NULL, 0, ${Date.now()})
       ON CONFLICT(slug) DO UPDATE SET
         code=excluded.code, title=excluded.title, credits=excluded.credits, term=excluded.term,
         instructor=excluded.instructor, prereqs=excluded.prereqs, overview=excluded.overview, source_url=excluded.source_url;`,
    );

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
  }

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
