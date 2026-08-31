// Server-side reviewed-course registry. Rich authored content stays behind the
// API boundary; browser clients receive only the editable map/assessment
// summary produced by proposalFromReviewedTemplate.
//
// Two populations live behind one interface. The nine *authored* templates come
// from courses/*/content.json, carry scaffolds and exercise banks, and stay in
// the worker bundle. The ~10,000 *generated* McGill catalogue courses live in
// D1 (see migrations/0013_catalog_courses_in_d1.sql): imported as JSON they
// became a 5 MB chunk that V8 parsed as source at every isolate start, a cost
// the course-map path paid as much as onboarding. That is why every lookup here
// takes a Db.
import { sql } from 'drizzle-orm';
import rawCourses from '../../../courses/courses.json';
import type { Db } from '../../db/client';
import { courseContentSchema, type CourseContent } from './courseContent';
import { exerciseFileSchema, type ExerciseFile } from './exercises';
import type { CourseSetupProposal } from '../schemas/onboarding';
import {
  catalogLevels,
  catalogSourceUrl,
  codeSortKey,
  ftsMatchExpression,
  normalizeSearchText,
  KC_TYPE_BY_CODE,
  type CatalogAudience,
  type RawCatalogKc,
} from './catalogRows';

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

const rawBySlug = new Map((rawCourses as CourseMeta[]).map((course) => [course.slug, course]));

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

// ---------------------------------------------------------------------------
// Catalogue rows (D1)
// ---------------------------------------------------------------------------

/** The columns search needs. Deliberately excludes `kcs`, which is large. */
type CatalogSummaryRow = {
  slug: string;
  code: string;
  title: string;
  credits: number | null;
  department: string;
  faculty: string;
  audience: CatalogAudience;
  kc_count: number;
  sort_key: string;
  match_rank: number;
};

type CatalogTemplateRow = CatalogSummaryRow & { kcs: string };

const CATALOG_SUMMARY_COLUMNS = sql`c.slug, c.code, c.title, c.credits, c.department, c.faculty, c.audience, c.kc_count, c.sort_key`;

function summarizeCatalogRow(row: CatalogSummaryRow): ReviewedTemplateSummary {
  return {
    template_id: row.slug,
    code: row.code,
    title: row.title,
    credits: row.credits,
    levels: catalogLevels(row.audience),
    subject: row.code.split(' ')[0],
    ...(row.department ? { department: row.department } : {}),
    ...(row.faculty ? { faculty: row.faculty } : {}),
    branch_count: 1,
    kc_count: row.kc_count,
    assessment_count: 0,
  };
}

function expandCatalogRow(row: CatalogTemplateRow): CatalogCourse {
  const kcs = (typeof row.kcs === 'string' ? JSON.parse(row.kcs) : row.kcs) as RawCatalogKc[];
  return {
    code: row.code,
    slug: row.slug,
    title: row.title,
    ...(row.credits === null ? {} : { credits: row.credits }),
    subject: row.code.split(' ')[0],
    department: row.department,
    faculty: row.faculty,
    levels: catalogLevels(row.audience),
    source: catalogSourceUrl(row.code),
    kcs: kcs.map(([name, type]) => ({ name, type: KC_TYPE_BY_CODE[type] })),
  };
}

/** `undefined` when unfiltered, so callers can drop the clause entirely. */
function audienceClause(level: CourseMeta['level']) {
  if (level === 'undergraduate') return sql`c.audience in ('u', 'b')`;
  if (level === 'graduate') return sql`c.audience in ('g', 'b')`;
  return undefined;
}

export function listReviewedTemplates(db: Db): Promise<ReviewedTemplateSummary[]> {
  return db
    .all<CatalogSummaryRow>(sql`select ${CATALOG_SUMMARY_COLUMNS}, 0 as match_rank from catalog_courses c order by c.sort_key asc`)
    .then((rows) => [
      ...[...templates.values()].map(summarizeTemplate),
      ...rows.map(summarizeCatalogRow),
    ]);
}

type SearchRow = {
  summary: ReviewedTemplateSummary;
  searchable: string;
  normalizedCode: string;
  compactCode: string;
  normalizedTitle: string;
  /** Precomputed collation key; see codeSortKey. */
  sortKey: string;
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
    sortKey: codeSortKey(summary.code),
    authored,
  };
}

// Nine authored templates, so building their normalized search text once per
// isolate is free. The catalogue's equivalent is the seeded FTS5 index.
const authoredSearchRows = [...templates.values()].map((template) => searchRow(
  summarizeTemplate(template),
  template.content.branches.flatMap((branch) => [branch.name, ...branch.kcs.map((kc) => kc.name)]),
  true,
));

export type TemplateSearchResult = {
  /** The ranked window, bounded by options.limit. */
  results: ReviewedTemplateSummary[];
  /** Every match, so callers can report a count the window does not cap. */
  total: number;
  truncated: boolean;
};

type RankedMatch = { summary: ReviewedTemplateSummary; rank: number; sortKey: string };

/**
 * Search the reviewed catalog by code, title, aliases, department, or KC
 * names. Matching happens server-side so a large catalog does not need to be
 * downloaded in full just to populate onboarding search results.
 *
 * Returns the total alongside the window: a caller that only sees the window
 * cannot tell 100 matches from 1,700, and the onboarding picker reports the
 * count to the learner.
 *
 * The catalogue half runs entirely in SQLite — FTS5 selects the candidates and
 * the same CASE ranking the in-memory index used decides the order — so a
 * bounded search never materializes more than `limit` catalogue rows. The nine
 * authored rows are ranked in memory and merged in; because they are ranked on
 * the same scale, merging the two ordered lists and re-slicing is exact.
 */
export async function searchReviewedTemplates(
  db: Db,
  query = '',
  options: { level?: CourseMeta['level']; limit?: number } = {},
): Promise<TemplateSearchResult> {
  const normalized = normalizeSearchText(query);
  const terms = normalized ? normalized.split(' ') : [];
  const limit = options.limit && options.limit > 0 ? options.limit : null;

  const authoredMatches: RankedMatch[] = authoredSearchRows
    .filter(({ summary }) => !options.level || summary.level === options.level || summary.levels?.includes(options.level))
    .filter(({ searchable, compactCode }) => !normalized
      || terms.every((term) => searchable.includes(term) || compactCode.includes(term)))
    .map((row) => ({ summary: row.summary, rank: searchRank(row, normalized), sortKey: row.sortKey }));

  const catalog = await searchCatalog(db, normalized, terms, options.level, limit);

  // Array.prototype.sort is stable, so an authored row still wins a tie with a
  // catalogue row carrying the same code — the ordering the in-memory index had.
  const ranked = [...authoredMatches, ...catalog.matches]
    .sort((a, b) => b.rank - a.rank || (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  const total = authoredMatches.length + catalog.total;
  const window = limit ?? ranked.length;
  return {
    results: ranked.slice(0, window).map(({ summary }) => summary),
    total,
    truncated: total > window,
  };
}

async function searchCatalog(
  db: Db,
  normalized: string,
  terms: string[],
  level: CourseMeta['level'],
  limit: number | null,
): Promise<{ matches: RankedMatch[]; total: number }> {
  const audience = audienceClause(level);
  const limitClause = limit === null ? sql`` : sql` limit ${limit}`;

  // An empty query ranks every catalogue row 0, the same as the in-memory
  // index did, so there is nothing for FTS5 to match and the LIKE prefixes
  // below would degenerate to '%'.
  if (terms.length === 0) {
    const where = audience ? sql` where ${audience}` : sql``;
    const [rows, counted] = await Promise.all([
      db.all<CatalogSummaryRow>(sql`select ${CATALOG_SUMMARY_COLUMNS}, 0 as match_rank from catalog_courses c${where} order by c.sort_key asc${limitClause}`),
      db.all<{ total: number }>(sql`select count(*) as total from catalog_courses c${where}`),
    ]);
    return { matches: rows.map(rankedFromRow), total: counted[0]?.total ?? 0 };
  }

  const match = ftsMatchExpression(terms);
  const compactQuery = normalized.replaceAll(' ', '');
  // normalizeSearchText leaves only [a-z0-9 ], so these prefixes carry no LIKE
  // wildcards of their own and need no ESCAPE clause.
  const prefix = `${normalized}%`;
  const compactPrefix = `${compactQuery}%`;
  const rank = sql`case
      when c.compact_code = ${compactQuery} then 1000
      when c.normalized_code like ${prefix} or c.compact_code like ${compactPrefix} then 500
      when c.normalized_title like ${prefix} then 250
      else 0 end`;
  const from = sql`from catalog_courses_fts f join catalog_courses c on c.id = f.rowid where catalog_courses_fts match ${match}`;
  const where = audience ? sql`${from} and ${audience}` : from;

  const [rows, counted] = await Promise.all([
    db.all<CatalogSummaryRow>(sql`select ${CATALOG_SUMMARY_COLUMNS}, ${rank} as match_rank ${where} order by match_rank desc, c.sort_key asc${limitClause}`),
    db.all<{ total: number }>(sql`select count(*) as total ${where}`),
  ]);
  return { matches: rows.map(rankedFromRow), total: counted[0]?.total ?? 0 };
}

function rankedFromRow(row: CatalogSummaryRow): RankedMatch {
  return { summary: summarizeCatalogRow(row), rank: row.match_rank, sortKey: row.sort_key };
}

function searchRank(row: SearchRow, query: string): number {
  if (!query) return row.authored ? 1 : 0;
  const compactQuery = query.replaceAll(' ', '');
  if (row.compactCode === compactQuery) return 1000;
  if (row.normalizedCode.startsWith(query) || row.compactCode.startsWith(compactQuery)) return 500;
  if (row.normalizedTitle.startsWith(query)) return 250;
  return row.authored ? 25 : 0;
}

// A worker isolate can be asked for any of ~10,000 catalogue courses, so these
// caches are bounded rather than unbounded maps. Clearing wholesale is crude
// but correct: the entries are immutable derivations of seeded rows.
const CACHE_LIMIT = 256;

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

const generatedTemplateCache = new Map<string, ReviewedTemplate>();

export async function getReviewedTemplate(db: Db, templateId: string): Promise<ReviewedTemplate | null> {
  const authored = templates.get(templateId);
  if (authored) return authored;
  const cached = generatedTemplateCache.get(templateId);
  if (cached) return cached;
  const rows = await db.all<CatalogTemplateRow>(
    sql`select ${CATALOG_SUMMARY_COLUMNS}, c.kcs, 0 as match_rank from catalog_courses c where c.slug = ${templateId} limit 1`,
  );
  return rows[0] ? synthesizeCatalogTemplate(expandCatalogRow(rows[0])) : null;
}

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
  return remember(generatedTemplateCache, meta.slug, generated);
}

const revisionCache = new Map<string, Promise<string>>();

export async function getReviewedTemplateRevision(db: Db, templateId: string): Promise<string | null> {
  const cached = revisionCache.get(templateId);
  if (cached) return cached;
  const template = await getReviewedTemplate(db, templateId);
  if (!template) return null;
  return remember(revisionCache, templateId, crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(JSON.stringify(template)))
    .then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')));
}

/** The baseline of an already-loaded template; see getTemplateBaseline. */
export function templateBaseline(template: ReviewedTemplate): TemplateBaseline {
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

export async function getTemplateBaseline(db: Db, templateId: string): Promise<TemplateBaseline | null> {
  const template = await getReviewedTemplate(db, templateId);
  return template ? templateBaseline(template) : null;
}

export async function proposalFromReviewedTemplate(db: Db, templateId: string): Promise<CourseSetupProposal | null> {
  const template = await getReviewedTemplate(db, templateId);
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
