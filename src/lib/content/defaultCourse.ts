import rawDefaultCourse from '../../../courses/learning-how-to-learn/course.json';
import { validateCourseDraft } from '../domain/courseDraft';
import { courseDraftV2Schema, type CourseDraftV2 } from '../schemas/courseDraft';

export const DEFAULT_COURSE_KEY = 'learning-how-to-learn' as const;
export const DEFAULT_COURSE_VERSION = 1 as const;

const bundledDefaultCourse = validateCourseDraft(courseDraftV2Schema.parse(rawDefaultCourse));

/** Returns a fresh validated copy so callers cannot mutate the bundled fixture. */
export function loadDefaultCourse(): CourseDraftV2 {
  return structuredClone(bundledDefaultCourse);
}
