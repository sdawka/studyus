import { and, asc, eq, like, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { branches, courses, kcs } from '../../db/schema';
import type { CreateCourseInput, UpdateCourseInput } from '../schemas/courses';
import { NotFoundError, requireOwnedCourse } from './util';

// Spaced hue list (golden-angle-ish, not literal golden angle) new courses
// cycle through when no `color_hue` is supplied, keyed off how many courses
// the user already has — same list the seed script assigns from.
const COLOR_HUES = [235, 25, 150, 305, 65, 190, 340, 105, 45];

function slugify(code: string): string {
  return code
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Collision suffixing: -2, -3, ... appended to the base slug. One LIKE query
// fetches every slug that could collide, then the smallest free suffix is
// picked in memory (cheaper than a query per candidate).
async function uniqueSlug(db: Db, base: string): Promise<string> {
  const rows = await db
    .select({ slug: courses.slug })
    .from(courses)
    .where(like(courses.slug, `${base}%`));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// `courses.color` is a text column storing the OKLCH hue as a decimal
// string; the API's `color_hue` field is the integer. Kept as a private
// shaping step here (create/update only — list/get shaping is out of scope).
function shapeCourse(row: typeof courses.$inferSelect) {
  const { color, ...rest } = row;
  const parsed = color === null ? null : Number(color);
  return { ...rest, colorHue: parsed !== null && Number.isFinite(parsed) ? parsed : null };
}

export async function listCourses(
  db: Db,
  userId: string,
  opts: { includeMastery?: boolean; includeArchived?: boolean } = {},
) {
  const rows = (await db.select().from(courses).where(eq(courses.userId, userId))).filter(
    (c) => opts.includeArchived || !c.archived,
  );
  if (!opts.includeMastery) return rows.map((c) => ({ ...c, mastery: null, status: null }));

  const allKcs = await db.select({ courseId: kcs.courseId, mastery: kcs.mastery, status: kcs.status }).from(kcs);
  const byCourse = new Map<string, { mastery: number; status: string }[]>();
  for (const kc of allKcs) {
    const list = byCourse.get(kc.courseId) ?? [];
    list.push({ mastery: kc.mastery, status: kc.status });
    byCourse.set(kc.courseId, list);
  }

  return rows.map((c) => {
    const courseKcs = byCourse.get(c.id) ?? [];
    const mastery = courseKcs.length
      ? Math.round(courseKcs.reduce((sum, k) => sum + k.mastery, 0) / courseKcs.length)
      : 0;
    // A course only reads as "learning"+ once some KC actually has event
    // evidence — averaging mastery alone can't distinguish "9 untouched
    // KCs" from "a course just getting started" (both average to 0).
    const hasEvidence = courseKcs.some((k) => k.status !== 'not-started');
    const status =
      courseKcs.length === 0 || !hasEvidence
        ? 'not-started'
        : mastery >= 80
          ? 'mastered'
          : mastery >= 40
            ? 'review'
            : 'learning';
    return { ...c, mastery, status };
  });
}

export async function getCourseBySlug(db: Db, userId: string, slug: string) {
  const rows = await db.select().from(courses).where(and(eq(courses.slug, slug), eq(courses.userId, userId))).limit(1);
  const course = rows[0];
  if (!course) throw new NotFoundError('Course');

  const courseBranches = await db
    .select()
    .from(branches)
    .where(eq(branches.courseId, course.id))
    .orderBy(asc(branches.sortOrder));

  const courseKcs = await db.select().from(kcs).where(eq(kcs.courseId, course.id)).orderBy(asc(kcs.sortOrder));

  const kcsByBranch = new Map<string, typeof courseKcs>();
  for (const kc of courseKcs) {
    const list = kcsByBranch.get(kc.branchId) ?? [];
    list.push(kc);
    kcsByBranch.set(kc.branchId, list);
  }

  return {
    ...course,
    branches: courseBranches.map((b) => ({ ...b, kcs: kcsByBranch.get(b.id) ?? [] })),
  };
}

// Slug is derived from `code` with -2/-3 collision suffixing; hue defaults
// to the next unused entry in COLOR_HUES (cycling by the user's existing
// course count) when `color_hue` isn't supplied. Course + its "General"
// branch (sort_order 0) are inserted in one db.batch so a course never
// exists without at least one branch.
export async function createCourse(db: Db, userId: string, input: CreateCourseInput) {
  const slug = await uniqueSlug(db, slugify(input.code));

  let hue = input.color_hue;
  if (hue === undefined) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(courses).where(eq(courses.userId, userId));
    hue = COLOR_HUES[Number(count) % COLOR_HUES.length];
  }

  const courseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();

  await db.batch([
    db.insert(courses).values({
      id: courseId,
      userId,
      code: input.code,
      slug,
      title: input.title,
      term: input.term,
      credits: input.credits,
      instructor: input.instructor,
      overview: input.overview,
      color: String(hue),
    }),
    db.insert(branches).values({ id: branchId, courseId, name: 'General', sortOrder: 0 }),
  ]);

  const rows = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  return shapeCourse(rows[0]);
}

// Partial update; ownership-checked via requireOwnedCourse (throws
// NotFoundError for a missing or cross-user course id). Never touches
// code/slug — the slug is immutable once assigned.
export async function updateCourse(db: Db, userId: string, courseId: string, input: UpdateCourseInput) {
  await requireOwnedCourse(db, userId, courseId);

  const patch: Partial<typeof courses.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.term !== undefined) patch.term = input.term;
  if (input.credits !== undefined) patch.credits = input.credits;
  if (input.instructor !== undefined) patch.instructor = input.instructor;
  if (input.overview !== undefined) patch.overview = input.overview;
  if (input.archived !== undefined) patch.archived = input.archived;
  if (input.color_hue !== undefined) patch.color = String(input.color_hue);

  if (Object.keys(patch).length > 0) {
    await db.update(courses).set(patch).where(eq(courses.id, courseId));
  }

  const rows = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  return shapeCourse(rows[0]);
}
