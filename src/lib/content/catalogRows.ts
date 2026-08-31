// Shared shape of one generated McGill catalogue course, used by three callers
// that must agree exactly: the worker's search/lookup path, the seed script
// that writes courses/mcgill-catalog.json into D1, and the test fixture
// builder. Keeping normalization here is what stops the seeded search text
// from silently drifting away from the query normalization.

export type CatalogAudience = 'u' | 'b' | 'g';
export type RawCatalogKc = [name: string, type: 'f' | 'a' | 'c' | 'r' | 'p'];
export type RawCatalogCourse = [
  code: string,
  title: string,
  credits: number | null,
  department: string,
  faculty: string,
  audience: CatalogAudience,
  kcs: RawCatalogKc[],
];

export const KC_TYPE_BY_CODE = { f: 'fact', a: 'association', c: 'concept', r: 'rule', p: 'principle' } as const;

export type CatalogCourseRow = {
  id: number;
  slug: string;
  code: string;
  title: string;
  credits: number | null;
  department: string;
  faculty: string;
  audience: CatalogAudience;
  kcs: RawCatalogKc[];
  normalizedCode: string;
  compactCode: string;
  normalizedTitle: string;
  sortKey: string;
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function catalogCompactCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function catalogSlug(code: string): string {
  return `mcgill-${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function catalogSourceUrl(code: string): string {
  return `https://coursecatalogue.mcgill.ca/courses/${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function catalogLevels(audience: CatalogAudience): Array<'undergraduate' | 'graduate'> {
  return audience === 'b' ? ['undergraduate', 'graduate'] : [audience === 'g' ? 'graduate' : 'undergraduate'];
}

/**
 * A plain-comparable stand-in for localeCompare(numeric) on a course code.
 *
 * Ordering ~10,000 codes through Intl collation costs tens of milliseconds of
 * worker CPU on every request. Zero-padding each digit run instead keeps
 * "COMP 2" before "COMP 10" while reducing the comparison to a string compare,
 * and SQLite can then satisfy the ordering from a stored column.
 */
export function codeSortKey(code: string): string {
  return code.toLowerCase().replace(/\d+/g, (digits) => digits.padStart(6, '0'));
}

export function catalogCourseRow(raw: RawCatalogCourse, id: number): CatalogCourseRow {
  const [code, title, credits, department, faculty, audience, kcs] = raw;
  return {
    id,
    slug: catalogSlug(code),
    code,
    title,
    credits,
    department,
    faculty,
    audience,
    kcs,
    normalizedCode: normalizeSearchText(code),
    compactCode: catalogCompactCode(code),
    normalizedTitle: normalizeSearchText(title),
    sortKey: codeSortKey(code),
  };
}

/**
 * The FTS5-indexed text for one catalogue row: the same fields the in-memory
 * index used to concatenate, plus the punctuation-free code so a learner who
 * types "comp202" still finds COMP 202.
 */
export function catalogSearchText(row: CatalogCourseRow): string {
  const words = normalizeSearchText([
    row.code,
    row.title,
    row.code.split(' ')[0],
    row.department,
    row.faculty,
    ...catalogLevels(row.audience),
    ...row.kcs.map(([name]) => name),
  ].filter(Boolean).join(' '));
  return `${words} ${row.compactCode}`;
}

/**
 * Turn normalized query terms into an FTS5 MATCH expression: every term is a
 * quoted prefix, ANDed implicitly. Quoting matters because a bare `and` or
 * `not` term would otherwise be read as an FTS5 operator. Terms are already
 * reduced to [a-z0-9]+ by normalizeSearchText, so no escaping is needed.
 */
export function ftsMatchExpression(terms: string[]): string {
  return terms.map((term) => `"${term}"*`).join(' ');
}
