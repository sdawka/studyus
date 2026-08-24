import rawCourses from '../../../courses/courses.json';
import type { CourseSetupProposal } from '../schemas/onboarding';

type RawCourse = {
  code: string;
  slug: string;
  title: string;
  credits?: number;
  branches?: Array<{ branch: string; concepts: Array<{ name: string; notes?: string }> }>;
};

export const MCGILL_TERMS = [
  { label: 'Fall 2026', starts_on: '2026-08-31', ends_on: '2026-12-22', timezone: 'America/Toronto' },
  { label: 'Winter 2027', starts_on: '2027-01-05', ends_on: '2027-04-30', timezone: 'America/Toronto' },
] as const;

export const DEMO_CATALOG_META = {
  institution: 'McGill University',
  program: 'Chemical Engineering',
  source_url: 'https://www.mcgill.ca/chemeng/undergrad/programcourses',
  term_source_url: 'https://www.mcgill.ca/importantdates/key-dates',
  last_verified: '2026-08-24',
} as const;

export const demoCourseCatalog = (rawCourses as RawCourse[]).map((course) => ({
  code: course.code,
  slug: course.slug,
  title: course.title,
  credits: course.credits,
  kc_count: course.branches?.reduce((sum, branch) => sum + branch.concepts.length, 0) ?? 0,
}));

export function proposalFromTemplate(slug: string, simulated = false): CourseSetupProposal | null {
  const course = (rawCourses as RawCourse[]).find((candidate) => candidate.slug === slug);
  if (!course) return null;
  const branches = (course.branches ?? []).map((branch, branchIndex) => ({
    client_id: crypto.randomUUID(),
    name: branch.branch,
    sort_order: branchIndex,
    kcs: branch.concepts.map((concept) => ({
      client_id: crypto.randomUUID(),
      name: concept.name,
      kc_type: 'concept' as const,
      ...(concept.notes ? { description: concept.notes } : {}),
      source_refs: [`${course.code} reviewed template`],
    })),
  }));
  if (branches.length === 0) {
    branches.push({
      client_id: crypto.randomUUID(),
      name: 'Foundations',
      sort_order: 0,
      kcs: [{
        client_id: crypto.randomUUID(),
        name: `${course.title} foundations`,
        kc_type: 'concept',
        source_refs: [`${course.code} template`],
      }],
    });
  }
  return {
    schema_version: 1,
    template_id: course.slug,
    course: { code: course.code, title: course.title, ...(course.credits ? { credits: course.credits } : {}) },
    branches,
    source: { kind: simulated ? 'simulated' : 'template' },
  };
}

export function manualProposal(code: string, title: string, topics: string[]): CourseSetupProposal {
  const cleanTopics = topics.map((topic) => topic.trim()).filter(Boolean);
  return {
    schema_version: 1,
    course: { code: code.trim(), title: title.trim() },
    branches: [{
      client_id: crypto.randomUUID(),
      name: 'Course map',
      sort_order: 0,
      kcs: cleanTopics.map((name) => ({
        client_id: crypto.randomUUID(),
        name,
        kc_type: 'concept',
        source_refs: ['Manual entry'],
      })),
    }],
    source: { kind: 'manual' },
  };
}

export function proposalFromExtractedText(filename: string, text: string): CourseSetupProposal {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#\d.)\s]+/, '').trim())
    .filter((line) => line.length >= 4 && line.length <= 120);
  const unique = [...new Set(lines)].slice(0, 12);
  const topics = unique.length ? unique : ['Course foundations', 'Core methods', 'Assessment review'];
  const base = filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return {
    ...manualProposal('COURSE', base || 'Imported course', topics),
    source: { kind: 'upload', filename },
  };
}
