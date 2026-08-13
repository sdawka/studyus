import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assessments, courses, events, kcs, studySessions, taskCourses, tasks } from '../../db/schema';
import { sweepTasks } from './taskSweep';
import type { CalendarItem } from '../types/calendar';

export type { CalendarItem };

// Mirrors EVENT_TYPES' snake_case naming convention (see schemas/events.ts) —
// 'lecture_attended' -> 'Lecture attended'.
function humanizeEventType(type: string): string {
  const spaced = type.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export async function getCalendar(db: Db, userId: string, fromMs: number, toMs: number, courseId?: string) {
  await sweepTasks(db, userId);

  const items: CalendarItem[] = [];

  // --- assessment_due -------------------------------------------------
  const assessmentConditions = [
    eq(courses.userId, userId),
    isNotNull(assessments.dueDate),
    gte(assessments.dueDate, fromMs),
    lte(assessments.dueDate, toMs),
  ];
  if (courseId) assessmentConditions.push(eq(assessments.courseId, courseId));

  const dueAssessments = await db
    .select({ assessment: assessments, courseId: courses.id, courseSlug: courses.slug })
    .from(assessments)
    .innerJoin(courses, eq(assessments.courseId, courses.id))
    .where(and(...assessmentConditions));

  for (const row of dueAssessments) {
    items.push({
      id: row.assessment.id,
      type: 'assessment_due',
      title: row.assessment.title,
      date: new Date(row.assessment.dueDate!).toISOString(),
      end_date: null,
      all_day: true,
      course_id: row.courseId,
      href: `/courses/${row.courseSlug}#assessments`,
      details: { assessment_type: row.assessment.type, weight_pct: row.assessment.weightPct },
    });
  }

  // --- task_due ---------------------------------------------------------
  const dueTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.dismissedAt),
        isNotNull(tasks.dueDate),
        gte(tasks.dueDate, fromMs),
        lte(tasks.dueDate, toMs),
      ),
    );

  // One grouped select over task_courses for every matched task, instead of
  // one query per task.
  const taskIds = dueTasks.map((t) => t.id);
  const links = taskIds.length ? await db.select().from(taskCourses).where(inArray(taskCourses.taskId, taskIds)) : [];
  const courseIdsByTask = new Map<string, string[]>();
  for (const link of links) {
    const list = courseIdsByTask.get(link.taskId) ?? [];
    list.push(link.courseId);
    courseIdsByTask.set(link.taskId, list);
  }

  for (const task of dueTasks) {
    const linkedCourseIds = courseIdsByTask.get(task.id) ?? [];
    if (courseId && !linkedCourseIds.includes(courseId)) continue;
    items.push({
      id: task.id,
      type: 'task_due',
      title: task.title,
      date: new Date(task.dueDate!).toISOString(),
      end_date: null,
      all_day: true,
      course_id: linkedCourseIds[0] ?? null,
      href: '/tasks',
      details: {
        done: task.done,
        course_ids: linkedCourseIds,
        task_type: task.type,
        parent_task_id: task.parentTaskId,
        class_session_id: task.classSessionId,
        completed_at: task.completedAt ? new Date(task.completedAt).toISOString() : null,
      },
    });
  }

  // --- study_session ------------------------------------------------------
  // COALESCE(scheduled_at, started_at) in [from, to] — a scheduled-but-not-yet-
  // started session sorts by its planned time, a started one by when it began.
  const sessionConditions = [
    eq(studySessions.userId, userId),
    sql`coalesce(${studySessions.scheduledAt}, ${studySessions.startedAt}) >= ${fromMs}`,
    sql`coalesce(${studySessions.scheduledAt}, ${studySessions.startedAt}) <= ${toMs}`,
  ];
  if (courseId) sessionConditions.push(eq(studySessions.courseId, courseId));

  const sessionRows = await db
    .select({ session: studySessions, courseCode: courses.code })
    .from(studySessions)
    .leftJoin(courses, eq(studySessions.courseId, courses.id))
    .where(and(...sessionConditions));

  for (const row of sessionRows) {
    const s = row.session;
    const startMs = s.scheduledAt ?? s.startedAt;
    const endMs = s.endedAt ?? startMs + (s.plannedMinutes ?? 60) * 60_000;
    items.push({
      id: s.id,
      type: 'study_session',
      title: `Study: ${row.courseCode ?? 'General'}`,
      date: new Date(startMs).toISOString(),
      end_date: new Date(endMs).toISOString(),
      all_day: false,
      course_id: s.courseId,
      href: '/planner',
      details: {
        intended_event_type: s.intendedEventType,
        planned_minutes: s.plannedMinutes,
        started_at: s.startedAt,
        ended_at: s.endedAt,
        scheduled_at: s.scheduledAt,
        completed: !!s.endedAt,
      },
    });
  }

  // --- event_logged ------------------------------------------------------
  const eventConditions = [eq(events.userId, userId), gte(events.ts, fromMs), lte(events.ts, toMs)];
  if (courseId) eventConditions.push(eq(events.courseId, courseId));

  const eventRows = await db
    .select({ event: events, courseSlug: courses.slug, kcName: kcs.name })
    .from(events)
    .leftJoin(courses, eq(events.courseId, courses.id))
    .leftJoin(kcs, eq(events.kcId, kcs.id))
    .where(and(...eventConditions));

  for (const row of eventRows) {
    const e = row.event;
    const title = row.kcName ? `${humanizeEventType(e.type)} · ${row.kcName}` : humanizeEventType(e.type);
    items.push({
      id: e.id,
      type: 'event_logged',
      title,
      date: new Date(e.ts).toISOString(),
      end_date: null,
      all_day: false,
      course_id: e.courseId,
      href: e.kcId ? `/courses/${row.courseSlug}/concepts` : '/planner',
      details: {
        event_type: e.type,
        kc_id: e.kcId,
        kc_name: row.kcName,
        is_instructional: e.isInstructional,
        is_assessment: e.isAssessment,
        source: e.source,
      },
    });
  }

  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}
