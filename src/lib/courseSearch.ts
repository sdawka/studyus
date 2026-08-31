/**
 * Search helpers for the onboarding course picker.
 *
 * The catalog can grow substantially, so normalized searchable text is built
 * once when the catalog changes rather than once for every keystroke/result.
 */
export type CourseSearchCourse = {
  code: string;
  title: string;
  slug: string;
  kc_count?: number;
  credits?: number;
  subject?: string | null;
  subjects?: string[] | null;
  department?: string | null;
  faculty?: string | null;
  level?: string | null;
  levels?: string[] | null;
  aliases?: string[] | null;
  [key: string]: unknown;
};

export type IndexedCourseSearchItem<T extends CourseSearchCourse = CourseSearchCourse> = {
  course: T;
  code: string;
  title: string;
  subjects: string;
  searchable: string;
};

export type CourseSearchResult<T extends CourseSearchCourse = CourseSearchCourse> = {
  results: T[];
  total: number;
  query: string;
  truncated: boolean;
};

/** Normalize accents, punctuation, and whitespace so common course-code forms match. */
export function normalizeCourseSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function courseSubjects(course: CourseSearchCourse): string[] {
  return [
    course.subject,
    ...(course.subjects ?? []),
    course.department,
    course.faculty,
    course.level,
    ...(course.levels ?? []),
    ...(course.aliases ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

export function createCourseSearchIndex<T extends CourseSearchCourse>(courses: T[]): IndexedCourseSearchItem<T>[] {
  return courses.map((course) => {
    const code = normalizeCourseSearchText(course.code);
    const title = normalizeCourseSearchText(course.title);
    const subjects = normalizeCourseSearchText(courseSubjects(course).join(' '));
    return {
      course,
      code,
      title,
      subjects,
      searchable: [code, code.replaceAll(' ', ''), title, subjects].filter(Boolean).join(' '),
    };
  });
}

function scoreCourse(item: IndexedCourseSearchItem, terms: string[]): number {
  return terms.reduce((score, term) => {
    const compactCode = item.code.replaceAll(' ', '');
    if (item.code === term || compactCode === term) return score + 100;
    if (item.code.startsWith(term) || compactCode.startsWith(term)) return score + 60;
    if (item.title.startsWith(term)) return score + 35;
    if (item.subjects.split(' ').includes(term)) return score + 20;
    return score + 1;
  }, 0);
}

/**
 * Search every indexed course, returning a bounded window suitable for DOM
 * rendering while retaining the total for an honest result count.
 */
export function searchCourseCatalog<T extends CourseSearchCourse>(
  index: IndexedCourseSearchItem<T>[],
  rawQuery: string,
  limit = 50,
): CourseSearchResult<T> {
  const query = normalizeCourseSearchText(rawQuery);
  const terms = query ? query.split(' ') : [];
  const matches = terms.length === 0
    ? index
    : index.filter((item) => terms.every((term) => item.searchable.includes(term)));

  const ranked = terms.length === 0
    ? matches
    : matches
      .map((item, order) => ({ item, order, score: scoreCourse(item, terms) }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map(({ item }) => item);
  const safeLimit = Math.max(1, Math.floor(limit));

  return {
    results: ranked.slice(0, safeLimit).map((item) => item.course),
    total: ranked.length,
    query,
    truncated: ranked.length > safeLimit,
  };
}
