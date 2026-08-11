// Learner profile aggregation. Not a table — computed on read from courses,
// kcs, and events. knowledgeMap is an explicit TODO stub per the plan.
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, events, kcs, users } from '../../db/schema';
import { NotFoundError } from './util';

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

export async function getProfile(db: Db, userId: string) {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userRows[0]) throw new NotFoundError('User');

  const userCourses = await db.select().from(courses).where(eq(courses.userId, userId));
  const allKcs = await db.select().from(kcs);

  const kcsByCourse = new Map<string, number[]>();
  for (const kc of allKcs) {
    if (!userCourses.some((c) => c.id === kc.courseId)) continue;
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

  const recentEvents = await db.select().from(events).where(eq(events.userId, userId)).orderBy(desc(events.ts)).limit(20);
  const allUserEvents = await db.select({ ts: events.ts }).from(events).where(eq(events.userId, userId));
  const { current, longest } = computeStreaks(allUserEvents.map((e) => dayKey(e.ts)));

  return {
    user_id: userId,
    overall_mastery: overallMastery,
    by_course: byCourse,
    longest_streak: longest,
    current_streak: current,
    recent_events: recentEvents,
    knowledge_map: null, // TODO
  };
}
