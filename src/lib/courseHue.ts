// Shared per-course hue: courses.color stores an OKLCH hue int 0-360.
// Courses created before hue assignment (or missing it) fall back to a
// stable hash of the slug so the tint is at least consistent across renders.
export function hashHue(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function hueFor(course: { slug: string; color: string | null }): number {
  const parsed = course.color ? Number(course.color) : NaN;
  return Number.isFinite(parsed) ? parsed : hashHue(course.slug);
}

export interface CourseHueInfo {
  slug: string;
  color: number | string | null;
}

/** Resolves a CalendarItem's course from a courseId -> course lookup, or undefined if unset/unknown. */
export function courseForItem<T extends CourseHueInfo>(
  item: { course_id: string | null },
  courseById: Map<string, T>,
): T | undefined {
  return item.course_id ? courseById.get(item.course_id) : undefined;
}

export function hueForItem<T extends CourseHueInfo>(
  item: { course_id: string | null },
  courseById: Map<string, T>,
): number {
  const course = courseForItem(item, courseById);
  return course ? hueFor({ slug: course.slug, color: course.color === null ? null : String(course.color) }) : 220;
}
