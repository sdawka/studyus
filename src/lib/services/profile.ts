// Learner profile aggregation. Not a table — computed on read from courses,
// kcs, and events.
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, events, kcs, users } from '../../db/schema';
import { NotFoundError } from './util';
import { getGlobalFrontier } from './zpd';
import { listUserMisconceptions } from './misconceptionLifecycle';

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function computeStreaks(eventDaysDesc: string[]): { current: number; longest: number } {
  if (eventDaysDesc.length === 0) return { current: 0, longest: 0 };
  const uniqueDays = [...new Set(eventDaysDesc)].sort().reverse(); // newest first

  let longest = 1;
  let run = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    const prev = new Date(uniqueDays[i - 1]);
    const cur = new Date(uniqueDays[i]);
    const diffDays = Math.round((prev.getTime() - cur.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) {
      run += 1;
    } else {
      longest = Math.max(longest, run);
      run = 1;
    }
  }
  longest = Math.max(longest, run);

  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 24 * 60 * 60 * 1000);
  let current = 0;
  if (uniqueDays[0] === today || uniqueDays[0] === yesterday) {
    current = 1;
    for (let i = 1; i < uniqueDays.length; i++) {
      const diffDays = Math.round(
        (new Date(uniqueDays[i - 1]).getTime() - new Date(uniqueDays[i]).getTime()) / (24 * 60 * 60 * 1000),
      );
      if (diffDays === 1) current += 1;
      else break;
    }
  }

  return { current, longest };
}

export async function getProfile(
  db: Db,
  userId: string,
  precomputed?: { frontierCounts: Awaited<ReturnType<typeof getGlobalFrontier>>['counts'] },
) {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userRows[0]) throw new NotFoundError('User');

  const userCourses = await db.select().from(courses).where(eq(courses.userId, userId));
  // Scoped via a join on courses rather than an unscoped `select().from(kcs)`
  // filtered in JS — the old query pulled every user's KCs off the table.
  const allKcs = await db
    .select({ courseId: kcs.courseId, mastery: kcs.mastery })
    .from(kcs)
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(eq(courses.userId, userId));

  const kcsByCourse = new Map<string, number[]>();
  for (const kc of allKcs) {
    const list = kcsByCourse.get(kc.courseId) ?? [];
    list.push(kc.mastery);
    kcsByCourse.set(kc.courseId, list);
  }

  const byCourse = userCourses.map((c) => {
    const masteries = kcsByCourse.get(c.id) ?? [];
    const mastery = masteries.length ? Math.round(masteries.reduce((a, b) => a + b, 0) / masteries.length) : 0;
    return { course_id: c.id, course_title: c.title, mastery };
  });

  const overallMasteries = byCourse.map((c) => c.mastery).filter((m) => m > 0);
  const overallMastery = overallMasteries.length
    ? Math.round(overallMasteries.reduce((a, b) => a + b, 0) / overallMasteries.length)
    : 0;

  const [recentEvents, misconceptionLifecycle] = await Promise.all([
    db.select().from(events).where(eq(events.userId, userId)).orderBy(desc(events.ts)).limit(20),
    listUserMisconceptions(db, userId),
  ]);
  const allUserEvents = await db.select({ ts: events.ts }).from(events).where(eq(events.userId, userId));
  const { current, longest } = computeStreaks(allUserEvents.map((e) => dayKey(e.ts)));

  // Reuses getGlobalFrontier's single pass over kcs/kc_edges rather than a
  // second bespoke count query — its `counts` are exactly the summary this
  // page needs (src/lib/zpd.ts's frontier/blocked/mastered/total shape).
  // Callers that already computed the frontier (e.g. profile.astro, which
  // needs the full by_course breakdown too) can pass its counts in to avoid
  // running the same query twice.
  const knowledgeMap = precomputed ? precomputed.frontierCounts : (await getGlobalFrontier(db, userId)).counts;

  return {
    user_id: userId,
    overall_mastery: overallMastery,
    by_course: byCourse,
    longest_streak: longest,
    current_streak: current,
    recent_events: recentEvents,
    knowledge_map: knowledgeMap,
    misconception_lifecycle: misconceptionLifecycle,
  };
}
