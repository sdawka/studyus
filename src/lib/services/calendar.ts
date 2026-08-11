import { and, eq, gte, lte, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assessments, courses, taskCourses, tasks } from '../../db/schema';

export type CalendarItem = {
  id: string;
  type: 'assessment_due' | 'task_due';
  title: string;
  date: string;
  course_id: string | null;
  details: Record<string, unknown>;
};

export async function getCalendar(db: Db, userId: string, fromMs: number, toMs: number, courseId?: string) {
  const items: CalendarItem[] = [];

  const courseConditions = [eq(courses.userId, userId), isNotNull(assessments.dueDate), gte(assessments.dueDate, fromMs), lte(assessments.dueDate, toMs)];
  if (courseId) courseConditions.push(eq(assessments.courseId, courseId));

  const dueAssessments = await db
    .select({ assessment: assessments, courseId: courses.id })
    .from(assessments)
    .innerJoin(courses, eq(assessments.courseId, courses.id))
    .where(and(...courseConditions));

  for (const row of dueAssessments) {
    items.push({
      id: row.assessment.id,
      type: 'assessment_due',
      title: row.assessment.title,
      date: new Date(row.assessment.dueDate!).toISOString(),
      course_id: row.courseId,
      details: { assessment_type: row.assessment.type, weight_pct: row.assessment.weightPct },
    });
  }

  const dueTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNotNull(tasks.dueDate), gte(tasks.dueDate, fromMs), lte(tasks.dueDate, toMs)));

  for (const task of dueTasks) {
    const links = await db.select().from(taskCourses).where(eq(taskCourses.taskId, task.id));
    const linkedCourseIds = links.map((l) => l.courseId);
    if (courseId && !linkedCourseIds.includes(courseId)) continue;
    items.push({
      id: task.id,
      type: 'task_due',
      title: task.title,
      date: new Date(task.dueDate!).toISOString(),
      course_id: linkedCourseIds[0] ?? null,
      details: { done: task.done, course_ids: linkedCourseIds },
    });
  }

  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}
