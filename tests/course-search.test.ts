import { describe, expect, it } from 'vitest';
import { createCourseSearchIndex, normalizeCourseSearchText, searchCourseCatalog } from '../src/lib/courseSearch';

const courses = [
  { slug: 'comp-202', code: 'COMP 202', title: 'Foundations of Programming', subject: 'Computer Science' },
  { slug: 'ecse-321', code: 'ECSE-321', title: 'Computer Architecture', subject: 'Electrical Engineering' },
  { slug: 'math-264', code: 'MATH 264', title: 'Advanced Calculus for Engineers', subjects: ['Mathematics', 'Engineering'] },
  { slug: 'arts-101', code: 'ARTS 101', title: 'Introduction to Visual Culture', department: 'Arts' },
];

describe('course catalog search', () => {
  const index = createCourseSearchIndex(courses);

  it('normalizes accents, punctuation, and code separators', () => {
    expect(normalizeCourseSearchText('ÉcSe-321 / Théorie')).toBe('ecse 321 theorie');
    expect(searchCourseCatalog(index, ' ecse 321 ').results[0].slug).toBe('ecse-321');
    expect(searchCourseCatalog(index, 'ecse321').results[0].slug).toBe('ecse-321');
  });

  it('searches code, title, and subject words', () => {
    expect(searchCourseCatalog(index, 'programming').results.map((course) => course.slug)).toEqual(['comp-202']);
    expect(searchCourseCatalog(index, 'mathematics').results.map((course) => course.slug)).toEqual(['math-264']);
    expect(searchCourseCatalog(index, 'arts').results.map((course) => course.slug)).toEqual(['arts-101']);
  });

  it('requires all query words, ranks stronger matches, and reports totals', () => {
    const result = searchCourseCatalog(index, 'computer', 1);
    expect(result.total).toBe(2);
    expect(result.results).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.results[0].slug).toBe('ecse-321');
    expect(searchCourseCatalog(index, 'not-a-course').total).toBe(0);
  });
});
