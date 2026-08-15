// Grade standing: sum(grade% x weight) / sum(weight) over graded *official*
// assessments, per course, plus a credit-weighted overall summary.
// 'practice' assessments (v1.3.1) never move the weighted grade, even when
// graded — they're excluded here before anything else runs.
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { assessments, courses } from '../../db/schema';

function weightedStanding(rows: (typeof assessments.$inferSelect)[]): number | null {
  const official = rows.filter((a) => a.kind === 'official');
  const graded = official.filter((a) => a.gradeReceived !== null && a.weightPct !== null);
  if (graded.length === 0) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const a of graded) {
    const pct = a.gradeMax && a.gradeMax > 0 ? (a.gradeReceived! / a.gradeMax) * 100 : a.gradeReceived!;
    weightedSum += pct * a.weightPct!;
    weightTotal += a.weightPct!;
  }
  return weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : null;
}

export async function getGradesSummary(db: Db, userId: string) {
  const userCourses = await db.select().from(courses).where(eq(courses.userId, userId));
  const courseIds = userCourses.map((c) => c.id);

  // One query for every course's assessments, grouped in JS — replaces the
  // former per-course query in this loop (an N+1 that ran once per course
  // on every dashboard/grades load).
  const allAssessments = courseIds.length
    ? await db.select().from(assessments).where(inArray(assessments.courseId, courseIds))
    : [];
  const assessmentsByCourse = new Map<string, typeof allAssessments>();
  for (const a of allAssessments) {
    const list = assessmentsByCourse.get(a.courseId) ?? [];
    list.push(a);
    assessmentsByCourse.set(a.courseId, list);
  }

  const byCourse = [];
  let creditWeightedSum = 0;
  let creditTotal = 0;

  for (const course of userCourses) {
    const courseAssessments = assessmentsByCourse.get(course.id) ?? [];
    const weightedGrade = weightedStanding(courseAssessments);

    if (weightedGrade !== null && course.credits) {
      creditWeightedSum += weightedGrade * course.credits;
      creditTotal += course.credits;
    }

    byCourse.push({
      course_id: course.id,
      course_title: course.title,
      weighted_grade: weightedGrade,
      assessments: courseAssessments.map((a) => ({
        assessment_id: a.id,
        title: a.title,
        type: a.type,
        weight_pct: a.weightPct,
        grade_received: a.gradeReceived,
        grade_max: a.gradeMax,
        kind: a.kind,
      })),
    });
  }

  return {
    overall_weighted_grade: creditTotal > 0 ? Math.round((creditWeightedSum / creditTotal) * 10) / 10 : null,
    by_course: byCourse,
  };
}
