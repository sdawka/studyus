// Seeds a representative slice of the McGill catalogue into a test file's D1.
//
// The Workers pool gives every test file its own migrated database, so loading
// all ~10,000 catalogue rows into each of them would cost seconds per file for
// a suite that runs in ~30s. tests/fixtures/mcgill-catalog-sample.json is a
// deterministic 461-course slice generated from the real catalogue by
// `npx tsx scripts/seed-catalog.ts --fixture`; regenerate it whenever
// courses/mcgill-catalog.json is rebuilt.
//
// Only the two catalogue-facing test files need it, so it is called explicitly
// rather than wired into setupFiles.
import fixture from '../fixtures/mcgill-catalog-sample.json';
import { catalogCourseRow, catalogSearchText, type RawCatalogCourse } from '../../src/lib/content/catalogRows';

/** How many courses the sample was drawn from — the real catalogue's size. */
export const CATALOG_SOURCE_TOTAL: number = fixture.source_total;
/** How many courses the sample actually seeds. */
export const CATALOG_SAMPLE_SIZE: number = fixture.courses.length;

const BATCH_SIZE = 100;

export async function seedCatalogSample(db: D1Database): Promise<void> {
  const rows = (fixture.courses as RawCatalogCourse[]).map((course, index) => catalogCourseRow(course, index + 1));
  const course = db.prepare(
    'INSERT INTO catalog_courses (id, slug, code, title, credits, department, faculty, audience, kcs, kc_count, normalized_code, compact_code, normalized_title, sort_key)'
    + ' VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)',
  );
  const indexed = db.prepare('INSERT INTO catalog_courses_fts (rowid, search_text) VALUES (?1, ?2)');
  const statements = rows.flatMap((row) => [
    course.bind(row.id, row.slug, row.code, row.title, row.credits, row.department, row.faculty, row.audience, JSON.stringify(row.kcs), row.kcs.length, row.normalizedCode, row.compactCode, row.normalizedTitle, row.sortKey),
    indexed.bind(row.id, catalogSearchText(row)),
  ]);
  for (let start = 0; start < statements.length; start += BATCH_SIZE) {
    await db.batch(statements.slice(start, start + BATCH_SIZE));
  }
}
