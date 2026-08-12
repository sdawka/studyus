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
