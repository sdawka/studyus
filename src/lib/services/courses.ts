import { and, asc, eq, gte, inArray, isNull, like, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { branches, classSessions, courses, kcs } from '../../db/schema';
import type { CreateCourseInput, UpdateCourseInput } from '../schemas/courses';
import { isoWeekday, localNoon } from './classSessions';
import { syncReviewedTemplateContent } from './courseMap';
import { ConflictError, NotFoundError, requireOwnedCourse } from './util';
import { hasUsableCourse } from './usableCourse';

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

// `courses.meetingDays` is a text column storing a JSON array of ISO weekday
// numbers; every course-shaped response exposes the parsed array (or null)
// under the same key instead of the raw JSON string.
function parseMeetingDaysColumn(raw: string | null): number[] | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function dedupeSortDays(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

// `courses.color` is a text column storing the OKLCH hue as a decimal
// string; the API's `color_hue` field is the integer. Kept as a private
// shaping step here (create/update only — list/get shaping is out of scope
// for `color`/`colorHue`, but meetingDays parsing applies everywhere below).
function shapeCourse(row: typeof courses.$inferSelect) {
  const { color, meetingDays, ...rest } = row;
  const parsed = color === null ? null : Number(color);
  return {
    ...rest,
    colorHue: parsed !== null && Number.isFinite(parsed) ? parsed : null,
    meetingDays: parseMeetingDaysColumn(meetingDays),
  };
}

export async function listCourses(
  db: Db,
  userId: string,
  opts: { includeMastery?: boolean; includeArchived?: boolean } = {},
) {
  const rows = (await db.select().from(courses).where(eq(courses.userId, userId))).filter(
    (c) => opts.includeArchived || !c.archived,
  );
  if (!opts.includeMastery)
    return rows.map((c) => ({ ...c, meetingDays: parseMeetingDaysColumn(c.meetingDays), mastery: null, status: null }));

  // Scoped via a join on courses rather than an unscoped `select().from(kcs)`
  // — the old query pulled every user's KCs before filtering in JS.
  const allKcs = await db
    .select({ courseId: kcs.courseId, mastery: kcs.mastery, status: kcs.status })
    .from(kcs)
    .innerJoin(branches, eq(kcs.branchId, branches.id))
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(eq(courses.userId, userId), isNull(branches.archivedAt), isNull(kcs.archivedAt)));
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
    return { ...c, meetingDays: parseMeetingDaysColumn(c.meetingDays), mastery, status };
  });
}

export async function getCourseBySlug(db: Db, userId: string, slug: string) {
  const rows = await db.select().from(courses).where(and(eq(courses.slug, slug), eq(courses.userId, userId))).limit(1);
  const course = rows[0];
  if (!course) throw new NotFoundError('Course');

  await syncReviewedTemplateContent(db, userId, course.id).catch((error) =>
    console.error(`Reviewed template sync failed for course ${course.id}`, error),
  );

  const courseBranches = await db
    .select()
    .from(branches)
    .where(and(eq(branches.courseId, course.id), isNull(branches.archivedAt)))
    .orderBy(asc(branches.sortOrder));

  const courseKcs = await db
    .select()
    .from(kcs)
    .innerJoin(branches, eq(kcs.branchId, branches.id))
    .where(and(eq(kcs.courseId, course.id), isNull(kcs.archivedAt), isNull(branches.archivedAt)))
    .orderBy(asc(kcs.sortOrder))
    .then((rows) => rows.map((row) => row.kcs));

  const kcsByBranch = new Map<string, typeof courseKcs>();
  for (const kc of courseKcs) {
    const list = kcsByBranch.get(kc.branchId) ?? [];
    list.push(kc);
    kcsByBranch.set(kc.branchId, list);
  }

  return {
    ...course,
    meetingDays: parseMeetingDaysColumn(course.meetingDays),
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
  const existing = await requireOwnedCourse(db, userId, courseId);

  // middleware.ts bounces a learner to /onboarding whenever they have no
  // usable course, and /courses is not on its allowed list — so archiving the
  // last one would strand them on a page that cannot unarchive it. The map
  // editor already refuses the equivalent move one level down
  // ('Keep at least one meaningful active concept.').
  // Only blocks the archive that would *remove* access. A learner who already
  // has no usable course (e.g. every course is still a placeholder map) loses
  // nothing by archiving, so that stays allowed.
  if (input.archived === true && !existing.archived) {
    const usableBefore = await hasUsableCourse(db, userId);
    const usableAfter = usableBefore && (await hasUsableCourse(db, userId, { excludeCourseId: courseId }));
    if (usableBefore && !usableAfter) {
      throw new ConflictError('Keep at least one active course — archiving this one would lock you out of the app.');
    }
  }

  const patch: Partial<typeof courses.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.term !== undefined) patch.term = input.term;
  if (input.credits !== undefined) patch.credits = input.credits;
  if (input.instructor !== undefined) patch.instructor = input.instructor;
  if (input.overview !== undefined) patch.overview = input.overview;
  if (input.archived !== undefined) patch.archived = input.archived;
  if (input.color_hue !== undefined) patch.color = String(input.color_hue);

  let newMeetingDays: number[] | null | undefined; // undefined = untouched by this PATCH
  if (input.meeting_days !== undefined) {
    newMeetingDays = input.meeting_days === null ? null : dedupeSortDays(input.meeting_days);
    patch.meetingDays = newMeetingDays === null ? null : JSON.stringify(newMeetingDays);
  }

  if (Object.keys(patch).length > 0) {
    await db.update(courses).set(patch).where(eq(courses.id, courseId));
  }

  if (newMeetingDays !== undefined) {
    await retireDroppedClassSessions(db, userId, courseId, parseMeetingDaysColumn(existing.meetingDays) ?? [], newMeetingDays ?? []);
  }

  const rows = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  return shapeCourse(rows[0]);
}

// v1.4: dropping a weekday from meetingDays retires any future, still-unmarked
// schedule-sourced class_sessions rows for days no longer in the new set.
// sweepClassSessions (classSessions.ts) is insert-only, so without this a
// session for a retired weekday — and the attend_class/review_after_class
// tasks it keeps minting — would linger forever. Past sessions and any
// session the student has already marked (attended/missed) are left alone:
// a schedule change later shouldn't erase attendance history. Deleting the
// class_sessions row cascades (tasks.class_session_id, ON DELETE CASCADE —
// see schema.ts) to any linked task, so there's no separate task cleanup.
async function retireDroppedClassSessions(
  db: Db,
  userId: string,
  courseId: string,
  oldDays: number[],
  newDays: number[],
): Promise<void> {
  const droppedDays = oldDays.filter((d) => !newDays.includes(d));
  if (droppedDays.length === 0) return;

  const todayNoon = localNoon(Date.now());
  const futureSessions = await db
    .select({ id: classSessions.id, date: classSessions.date })
    .from(classSessions)
    .where(
      and(
        eq(classSessions.courseId, courseId),
        eq(classSessions.userId, userId),
        eq(classSessions.source, 'schedule'),
        isNull(classSessions.status),
        gte(classSessions.date, todayNoon),
      ),
    );

  const idsToRemove = futureSessions.filter((s) => droppedDays.includes(isoWeekday(s.date))).map((s) => s.id);
  if (idsToRemove.length === 0) return;

  await db.delete(classSessions).where(inArray(classSessions.id, idsToRemove));
}
