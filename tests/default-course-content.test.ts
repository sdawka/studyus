import { describe, expect, it } from 'vitest';
import { validateCourseDraft } from '../src/lib/domain/courseDraft';
import { DEFAULT_COURSE_KEY, DEFAULT_COURSE_VERSION, loadDefaultCourse } from '../src/lib/content/defaultCourse';

const approvedModuleTitles = [
  'How do you know you’ve learned something?',
  'How do you access what you’ve learned?',
  'What does learning feel like?',
  'What helps you learn best?',
  'How can you keep getting better at learning?',
];

describe('bundled Learning How to Learn course', () => {
  it('loads a valid, versioned course with the approved module sequence', () => {
    const course = loadDefaultCourse();

    expect(DEFAULT_COURSE_KEY).toBe('learning-how-to-learn');
    expect(DEFAULT_COURSE_VERSION).toBe(1);
    expect(validateCourseDraft(course)).toEqual(course);
    expect(course.modules.sort((a, b) => a.sort_order - b.sort_order).map((module) => module.title)).toEqual(approvedModuleTitles);
  });

  it('covers each KC form and intended learning process', () => {
    const course = loadDefaultCourse();

    expect(new Set(course.kcs.map((kc) => kc.kc_form))).toEqual(new Set([
      'constant_constant',
      'variable_constant',
      'variable_variable',
    ]));
    expect(new Set(course.experiences.flatMap((experience) => experience.intended_processes))).toEqual(new Set([
      'memory_fluency',
      'induction_refinement',
      'understanding_sensemaking',
    ]));
  });

  it('makes every KC teachable and inspectable through examples, scored practice, and linked references', () => {
    const course = loadDefaultCourse();
    const referenced = new Set(course.references.flatMap((reference) => reference.kc_ids));

    for (const kc of course.kcs) {
      expect(course.examples.some((example) => example.kc_ids.includes(kc.id))).toBe(true);
      expect(course.experiences.some((experience) => experience.evidence?.target_kc_ids.includes(kc.id))).toBe(true);
      expect(referenced).toContain(kc.id);
    }

    expect(course.examples.some((example) => example.content.kind === 'contrast')).toBe(true);
    expect(course.references.some((reference) => reference.citation.includes('Koedinger'))).toBe(true);
  });
});
