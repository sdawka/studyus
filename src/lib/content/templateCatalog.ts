// Server-side reviewed-course registry. Rich authored content stays behind the
// API boundary; browser clients receive only the editable map/assessment
// summary produced by proposalFromReviewedTemplate.
import rawCourses from '../../../courses/courses.json';
import rawMcGillCatalog from '../../../courses/mcgill-catalog.json';
import { courseContentSchema, type CourseContent } from './courseContent';
import { exerciseFileSchema, type ExerciseFile } from './exercises';
import type { CourseSetupProposal } from '../schemas/onboarding';

type CourseMeta = {
  code: string;
  slug: string;
  title: string;
  credits?: number;
  overview?: string;
  source?: string;
  /** Optional catalog facets used by search/filter clients. */
  level?: 'undergraduate' | 'graduate';
  levels?: Array<'undergraduate' | 'graduate'>;
  subject?: string;
  subjects?: string[];
  department?: string;
  faculty?: string;
  aliases?: string[];
};

type CatalogKc = { name: string; type: 'fact' | 'association' | 'concept' | 'rule' | 'principle' };
type CatalogCourse = CourseMeta & { kcs: CatalogKc[] };
type RawCatalogKc = [name: string, type: 'f' | 'a' | 'c' | 'r' | 'p'];
type RawCatalogCourse = [
  code: string,
  title: string,
  credits: number | null,
  department: string,
  faculty: string,
  audience: 'u' | 'b' | 'g',
  kcs: RawCatalogKc[],
];

const rawBySlug = new Map((rawCourses as CourseMeta[]).map((course) => [course.slug, course]));
function catalogSlug(code: string): string {
  return `mcgill-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

const catalogBySlug = new Map(
  (rawMcGillCatalog.courses as RawCatalogCourse[]).map((course) => [catalogSlug(course[0]), course]),
);

function expandCatalogCourse(raw: RawCatalogCourse): CatalogCourse {
  const [code, title, credits, department, faculty, audience, rawKcs] = raw;
  const typeByCode = { f: 'fact', a: 'association', c: 'concept', r: 'rule', p: 'principle' } as const;
  const levels: CourseMeta['levels'] = audience === 'b'
    ? ['undergraduate', 'graduate']
    : [audience === 'g' ? 'graduate' : 'undergraduate'];
  const compact = code.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    code,
    slug: `mcgill-${compact}`,
    title,
    ...(credits === null ? {} : { credits }),
    subject: code.split(' ')[0],
    department,
    faculty,
    levels,
    source: `https://coursecatalogue.mcgill.ca/courses/${compact}`,
    kcs: rawKcs.map(([name, type]) => ({ name, type: typeByCode[type] })),
  };
}

// Keep the catalog data-driven: every reviewed course is represented by a
// courses/<slug>/content.json file, so adding a course never requires another
// hand-written import in this module. Vite expands these globs at build time,
// including JSON in the Cloudflare bundle. Exercises are optional for a
// reviewed map (older/newly authored maps can still be imported); existing
// exercise banks remain fully preserved when present.
type GlobModule = { default: unknown } | unknown;
const contentModules = import.meta.glob('../../../courses/*/content.json', { eager: true, import: 'default' }) as Record<string, GlobModule>;
const exerciseModules = import.meta.glob('../../../courses/*/exercises.json', { eager: true, import: 'default' }) as Record<string, GlobModule>;

function moduleValue(module: GlobModule): unknown {
  return module && typeof module === 'object' && 'default' in module ? module.default : module;
}

function courseSlugFromPath(path: string, filename: 'content.json' | 'exercises.json'): string | null {
  const marker = `courses/`;
  const start = path.lastIndexOf(marker);
  if (start < 0 || !path.endsWith(`/${filename}`)) return null;
  const slug = path.slice(start + marker.length, -filename.length - 1);
  return slug || null;
}

const exercisesBySlug = new Map<string, unknown>();
for (const [path, raw] of Object.entries(exerciseModules)) {
  const slug = courseSlugFromPath(path, 'exercises.json');
  if (slug) exercisesBySlug.set(slug, moduleValue(raw));
}

export type ReviewedTemplate = {
  meta: CourseMeta;
  content: CourseContent;
  exercises: ExerciseFile;
};

export type TemplateBaseline = {
  branches: Array<{
    ref: string;
    name: string;
    sort_order: number;
    kcs: Array<{
      ref: string;
      name: string;
      kc_type: string;
      description: string;
      practice_notes: string;
      sort_order: number;
      prereq_refs: string[];
    }>;
  }>;
};

const templates = new Map<string, ReviewedTemplate>();
for (const [path, contentRawModule] of Object.entries(contentModules)) {
  const content = courseContentSchema.parse(moduleValue(contentRawModule));
  const slug = courseSlugFromPath(path, 'content.json');
  if (!slug || slug !== content.course_slug) throw new Error(`Reviewed template path does not match course_slug: ${path}`);
  const exercises = exerciseFileSchema.parse(exercisesBySlug.get(slug) ?? { schema_version: 1, exercises: [] });
  const meta = rawBySlug.get(content.course_slug);
  if (!meta) throw new Error(`Reviewed template metadata missing for ${content.course_slug}`);
  templates.set(content.course_slug, { meta, content, exercises });
}

// Make omissions obvious during development and CI while tolerating an
// exercises file being authored after its content map.
for (const path of Object.keys(exerciseModules)) {
  const slug = courseSlugFromPath(path, 'exercises.json');
  if (slug && !templates.has(slug)) throw new Error(`Exercises found without reviewed content.json for ${slug}`);
}

function assessmentRef(index: number, title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'assessment';
  return `${index + 1}-${slug}`;
}

export type ReviewedTemplateSummary = ReturnType<typeof summarizeTemplate>;

function summarizeTemplate({ meta, content }: ReviewedTemplate): {
  template_id: string;
  code: string;
  title: string;
  credits: number | null;
  overview?: string;
  source?: string;
  level?: CourseMeta['level'];
  levels?: CourseMeta['levels'];
  subject?: string;
  subjects?: string[];
  department?: string;
  faculty?: string;
  aliases?: string[];
  branch_count: number;
  kc_count: number;
  assessment_count: number;
} {
  return {
    template_id: meta.slug,
    code: meta.code,
    title: meta.title,
    credits: meta.credits ?? null,
    ...(meta.level ? { level: meta.level } : {}),
    ...(meta.levels ? { levels: meta.levels } : {}),
    ...(meta.subject ? { subject: meta.subject } : {}),
    ...(meta.subjects ? { subjects: meta.subjects } : {}),
    ...(meta.department ? { department: meta.department } : {}),
    ...(meta.faculty ? { faculty: meta.faculty } : {}),
    ...(meta.aliases ? { aliases: meta.aliases } : {}),
    branch_count: content.branches.length,
    kc_count: content.branches.reduce((sum, branch) => sum + branch.kcs.length, 0),
    assessment_count: content.assessments.filter((assessment) => assessment.kind === 'official').length,
  };
}

export function listReviewedTemplates() {
  return [
    ...[...templates.values()].map(summarizeTemplate),
    ...catalogSearchRows.map(({ summary }) => summary),
  ];
}

type SearchRow = {
  summary: ReviewedTemplateSummary;
  searchable: string;
  normalizedCode: string;
  compactCode: string;
  normalizedTitle: string;
  authored: boolean;
};

function searchRow(
  summary: ReviewedTemplateSummary,
  kcText: string[],
  authored: boolean,
): SearchRow {
  const normalizedCode = normalizeSearchText(summary.code);
  return {
    summary,
    searchable: normalizeSearchText([
      summary.code,
      summary.title,
      summary.subject,
      ...(summary.subjects ?? []),
      summary.department,
      summary.faculty,
      summary.level,
      ...(summary.levels ?? []),
      ...(summary.aliases ?? []),
      ...kcText,
    ].filter(Boolean).join(' ')),
    normalizedCode,
    compactCode: normalizedCode.replaceAll(' ', ''),
    normalizedTitle: normalizeSearchText(summary.title),
    authored,
  };
}

function summarizeRawCatalogCourse(raw: RawCatalogCourse): ReviewedTemplateSummary {
  const [code, title, credits, department, faculty, audience, kcs] = raw;
  const levels: CourseMeta['levels'] = audience === 'b'
    ? ['undergraduate', 'graduate']
    : [audience === 'g' ? 'graduate' : 'undergraduate'];
  return {
    template_id: catalogSlug(code),
    code,
    title,
    credits,
    levels,
    subject: code.split(' ')[0],
    ...(department ? { department } : {}),
    ...(faculty ? { faculty } : {}),
    branch_count: 1,
    kc_count: kcs.length,
    assessment_count: 0,
  };
}

// Building normalized search text is the expensive part of catalog search.
// Do it once per worker isolate instead of rebuilding ~10,000 expanded course
// objects for every onboarding keystroke.
const authoredSearchRows = [...templates.values()].map((template) => searchRow(
  summarizeTemplate(template),
  template.content.branches.flatMap((branch) => [branch.name, ...branch.kcs.map((kc) => kc.name)]),
  true,
));
const catalogSearchRows = (rawMcGillCatalog.courses as RawCatalogCourse[]).map((raw) => searchRow(
  summarizeRawCatalogCourse(raw),
  raw[6].map(([name]) => name),
  false,
));
const templateSearchRows = [...authoredSearchRows, ...catalogSearchRows];

/**
 * Search the reviewed catalog by code, title, aliases, department, or KC
 * names. Matching happens server-side so a large catalog does not need to be
 * downloaded in full just to populate onboarding search results.
 */
export function searchReviewedTemplates(query = '', options: { level?: CourseMeta['level']; limit?: number } = {}) {
  const normalized = normalizeSearchText(query);
  const terms = normalized ? normalized.split(' ') : [];
  const matches = templateSearchRows
    .filter(({ summary }) => !options.level || summary.level === options.level || summary.levels?.includes(options.level))
    .filter(({ searchable, compactCode }) => !normalized
      || terms.every((term) => searchable.includes(term) || compactCode.includes(term)))
    .sort((a, b) => searchRank(b, normalized) - searchRank(a, normalized)
      || a.summary.code.localeCompare(b.summary.code, undefined, { numeric: true, sensitivity: 'base' }))
    .map(({ summary }) => summary);
  return options.limit && options.limit > 0 ? matches.slice(0, options.limit) : matches;
}

function searchRank(row: SearchRow, query: string): number {
  if (!query) return row.authored ? 1 : 0;
  const compactQuery = query.replaceAll(' ', '');
  if (row.compactCode === compactQuery) return 1000;
  if (row.normalizedCode.startsWith(query) || row.compactCode.startsWith(compactQuery)) return 500;
  if (row.normalizedTitle.startsWith(query)) return 250;
  return row.authored ? 25 : 0;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function getReviewedTemplate(templateId: string): ReviewedTemplate | null {
  const authored = templates.get(templateId);
  if (authored) return authored;
  const catalogCourse = catalogBySlug.get(templateId);
  return catalogCourse ? synthesizeCatalogTemplate(expandCatalogCourse(catalogCourse)) : null;
}

const generatedTemplateCache = new Map<string, ReviewedTemplate>();

function safeSlug(value: string, fallback: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || fallback;
}

function synthesizeCatalogTemplate(meta: CatalogCourse): ReviewedTemplate {
  const cached = generatedTemplateCache.get(meta.slug);
  if (cached) return cached;
  const usedSlugs = new Set<string>();
  const kcs = meta.kcs.map((kc, index) => {
    const base = safeSlug(kc.name, `concept-${index + 1}`);
    let slug = base;
    let suffix = 2;
    while (usedSlugs.has(slug)) slug = `${base}-${suffix++}`;
    usedSlugs.add(slug);
    return {
      slug,
      name: kc.name,
      kc_type: kc.type,
      description: `Understand and use ${kc.name.toLocaleLowerCase()} within ${meta.code} ${meta.title}. This outline is derived from the official catalogue description and can be refined from the syllabus.`,
      practice_notes: `Explain ${kc.name.toLocaleLowerCase()} in your own words, then connect it to a representative example from class.`,
      sort_order: index + 1,
      prereqs: [],
      resources: [],
      scaffolds: [{
        kind: 'retrieval_prompt' as const,
        level: 3 as const,
        title: `Retrieve: ${kc.name}`,
        body: `Without notes, explain what ${kc.name.toLocaleLowerCase()} means in this course and give one concrete example. Then check your answer against the syllabus or class notes.`,
        details: {},
      }],
      misconceptions: [],
    };
  });
  const content = courseContentSchema.parse({
    schema_version: 1,
    course_slug: meta.slug,
    branches: [{ slug: 'catalogue-outline', name: 'Catalogue outline', sort_order: 1, kcs }],
    course_resources: meta.source ? [{ label: 'McGill Course Catalogue', url: meta.source, kind: 'canonical', pinned: true }] : [],
    assessments: [{
      title: 'Course map self-check', type: 'quiz', kind: 'practice',
      kc_slugs: kcs.map((kc) => `#${kc.slug}`),
    }],
  });
  const generated = { meta, content, exercises: exerciseFileSchema.parse({ schema_version: 1, exercises: [] }) };
  generatedTemplateCache.set(meta.slug, generated);
  return generated;
}

const revisionCache = new Map<string, Promise<string>>();

export function getReviewedTemplateRevision(templateId: string): Promise<string | null> {
  const template = getReviewedTemplate(templateId);
  if (!template) return Promise.resolve(null);
  let revision = revisionCache.get(templateId);
  if (!revision) {
    revision = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(JSON.stringify(template)))
      .then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
    revisionCache.set(templateId, revision);
  }
  return revision;
}

export function getTemplateBaseline(templateId: string): TemplateBaseline | null {
  const template = getReviewedTemplate(templateId);
  if (!template) return null;
  return {
    branches: template.content.branches.map((branch) => ({
      ref: branch.slug,
      name: branch.name,
      sort_order: branch.sort_order,
      kcs: branch.kcs.map((kc) => ({
        ref: kc.slug,
        name: kc.name,
        kc_type: kc.kc_type,
        description: kc.description,
        practice_notes: kc.practice_notes,
        sort_order: kc.sort_order,
        prereq_refs: kc.prereqs,
      })),
    })),
  };
}

export function proposalFromReviewedTemplate(templateId: string): CourseSetupProposal | null {
  const template = getReviewedTemplate(templateId);
  if (!template) return null;
  return {
    schema_version: 1,
    template_id: templateId,
    course: {
      code: template.meta.code,
      title: template.meta.title,
      ...(template.meta.credits !== undefined ? { credits: template.meta.credits } : {}),
    },
    branches: template.content.branches.map((branch) => ({
      client_id: crypto.randomUUID(),
      template_ref: branch.slug,
      included: true,
      name: branch.name,
      sort_order: branch.sort_order,
      kcs: branch.kcs.map((kc) => ({
        client_id: crypto.randomUUID(),
        template_ref: kc.slug,
        included: true,
        name: kc.name,
        kc_type: kc.kc_type,
        description: kc.description,
        sort_order: kc.sort_order,
        prereq_refs: kc.prereqs,
        source_refs: [`${template.meta.code} ${templates.has(templateId) ? 'reviewed template' : 'McGill catalogue outline'}`],
      })),
    })),
    assessments: template.content.assessments.map((assessment, index) => ({
      template_ref: assessmentRef(index, assessment.title),
      title: assessment.title,
      type: assessment.type,
      kind: assessment.kind,
      ...(assessment.weight_pct !== undefined ? { weight_pct: assessment.weight_pct } : {}),
      date_status: assessment.kind === 'practice' ? 'unknown' : 'unset',
    })),
    source: { kind: 'template' },
  };
}

export function getAssessmentTemplateRef(index: number, title: string): string {
  return assessmentRef(index, title);
}
