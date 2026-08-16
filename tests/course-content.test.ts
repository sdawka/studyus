// Validates the courses/<slug>/content.json Zod schema (courses/content-schema.md,
// schema_version 1) and the resolveContentGraph resolver against inline
// fixtures, then — best-effort — validates any real content.json files that
// exist on disk at run time (skipped gracefully if none exist, or if this
// runtime has no usable filesystem access).
import { describe, expect, it } from 'vitest';
import { type CourseContent, courseContentSchema, resolveContentGraph } from '../src/lib/content/courseContent';

const validFixture = {
  schema_version: 1,
  course_slug: 'test-course-a',
  branches: [
    {
      slug: 'branch-one',
      name: 'Branch One',
      sort_order: 1,
      kcs: [
        {
          slug: 'kc-one',
          name: 'KC One',
          kc_type: 'fact',
          description: 'A fact KC for the fixture.',
          practice_notes: 'Drill it with spaced retrieval.',
          sort_order: 1,
          resources: [{ label: 'Reference', url: 'https://example.com/ref', kind: 'canonical' }],
          scaffolds: [{ kind: 'retrieval_prompt', level: 1, title: 'Recall prompt', body: 'What is the fact?' }],
        },
        {
          slug: 'kc-two',
          name: 'KC Two',
          kc_type: 'concept',
          description: 'A concept KC that depends on kc-one.',
          practice_notes: 'Classify examples.',
          sort_order: 2,
          prereqs: ['#kc-one'],
        },
      ],
    },
  ],
  assessments: [
    {
      title: 'Midterm',
      type: 'midterm',
      kind: 'official',
      weight_pct: 100,
      kc_slugs: ['#kc-one', '#kc-two'],
    },
  ],
};

describe('courseContentSchema', () => {
  it('accepts a minimal valid content.json fixture', () => {
    expect(() => courseContentSchema.parse(validFixture)).not.toThrow();
  });

  it('rejects a schema_version other than 1', () => {
    expect(() => courseContentSchema.parse({ ...validFixture, schema_version: 2 })).toThrow();
  });

  it('rejects a non-kebab-case course_slug', () => {
    expect(() => courseContentSchema.parse({ ...validFixture, course_slug: 'Test_Course_A' })).toThrow();
  });

  it('rejects a branch with no KCs', () => {
    const bad = { ...validFixture, branches: [{ slug: 'empty', name: 'Empty', sort_order: 1, kcs: [] }] };
    expect(() => courseContentSchema.parse(bad)).toThrow();
  });

  it('rejects an invalid kc_type', () => {
    const bad = structuredClone(validFixture) as any;
    bad.branches[0].kcs[0].kc_type = 'not-a-real-type';
    expect(() => courseContentSchema.parse(bad)).toThrow();
  });

  it('rejects a malformed prereq ref (missing leading #)', () => {
    const bad = structuredClone(validFixture) as any;
    bad.branches[0].kcs[1].prereqs = ['kc-one'];
    expect(() => courseContentSchema.parse(bad)).toThrow();
  });

  it('rejects an invalid resource url', () => {
    const bad = structuredClone(validFixture) as any;
    bad.branches[0].kcs[0].resources = [{ label: 'x', url: 'not-a-url', kind: 'canonical' }];
    expect(() => courseContentSchema.parse(bad)).toThrow();
  });

  it('rejects an out-of-range scaffold level', () => {
    const bad = structuredClone(validFixture) as any;
    bad.branches[0].kcs[0].scaffolds = [{ kind: 'retrieval_prompt', level: 4, title: 't', body: 'b' }];
    expect(() => courseContentSchema.parse(bad)).toThrow();
  });

  it('rejects an unknown top-level field (strict object)', () => {
    expect(() => courseContentSchema.parse({ ...validFixture, unexpected_field: true })).toThrow();
  });
});

function kc(slug: string, opts: Partial<Record<string, unknown>> = {}) {
  return {
    slug,
    name: slug,
    kc_type: 'concept',
    description: 'd',
    practice_notes: 'p',
    sort_order: 1,
    ...opts,
  };
}

describe('resolveContentGraph', () => {
  const courseA = courseContentSchema.parse({
    schema_version: 1,
    course_slug: 'course-a',
    branches: [
      {
        slug: 'branch-1',
        name: 'Branch 1',
        sort_order: 1,
        kcs: [kc('kc-a1'), kc('kc-a2', { prereqs: ['#kc-a1'] })],
      },
    ],
  });

  const courseB = courseContentSchema.parse({
    schema_version: 1,
    course_slug: 'course-b',
    branches: [
      {
        slug: 'branch-1',
        name: 'Branch 1',
        sort_order: 1,
        kcs: [kc('kc-b1', { prereqs: ['course-a#kc-a2', '#nonexistent-kc'] })],
      },
    ],
    assessments: [{ title: 'Quiz', type: 'quiz', kind: 'official', kc_slugs: ['#kc-b1', 'course-a#kc-a1'] }],
  });

  it('resolves a same-course prereq ref into an edge', () => {
    const graph = resolveContentGraph([courseA]);
    expect(graph.edges).toContainEqual({ kcKey: 'course-a#kc-a2', prereqKcKey: 'course-a#kc-a1' });
  });

  it('resolves a cross-course prereq ref into an edge', () => {
    const graph = resolveContentGraph([courseA, courseB]);
    expect(graph.edges).toContainEqual({ kcKey: 'course-b#kc-b1', prereqKcKey: 'course-a#kc-a2' });
  });

  it('warns on and skips an unresolvable prereq ref', () => {
    const graph = resolveContentGraph([courseA, courseB]);
    expect(graph.warnings.some((w) => w.includes('nonexistent-kc'))).toBe(true);
    expect(graph.edges.some((e) => e.prereqKcKey.includes('nonexistent'))).toBe(false);
  });

  it('resolves assessment kc_slugs across courses', () => {
    const graph = resolveContentGraph([courseA, courseB]);
    expect(graph.assessmentLinks).toContainEqual({ courseSlug: 'course-b', assessmentIndex: 0, kcKey: 'course-b#kc-b1' });
    expect(graph.assessmentLinks).toContainEqual({ courseSlug: 'course-b', assessmentIndex: 0, kcKey: 'course-a#kc-a1' });
  });

  it('throws with the cycle path on a prerequisite cycle', () => {
    const cyclic = courseContentSchema.parse({
      schema_version: 1,
      course_slug: 'course-c',
      branches: [
        {
          slug: 'branch-1',
          name: 'Branch 1',
          sort_order: 1,
          kcs: [kc('kc-c1', { prereqs: ['#kc-c2'] }), kc('kc-c2', { prereqs: ['#kc-c1'] })],
        },
      ],
    });
    expect(() => resolveContentGraph([cyclic])).toThrow(/cycle/i);
  });

  it('throws on a cycle that spans courses via cross-course edges', () => {
    const crossA = courseContentSchema.parse({
      schema_version: 1,
      course_slug: 'cross-a',
      branches: [{ slug: 'b1', name: 'B1', sort_order: 1, kcs: [kc('x1', { prereqs: ['cross-b#y1'] })] }],
    });
    const crossB = courseContentSchema.parse({
      schema_version: 1,
      course_slug: 'cross-b',
      branches: [{ slug: 'b1', name: 'B1', sort_order: 1, kcs: [kc('y1', { prereqs: ['cross-a#x1'] })] }],
    });
    expect(() => resolveContentGraph([crossA, crossB])).toThrow(/cycle/i);
  });
});

describe('real courses/*/content.json files (best-effort; skips gracefully)', () => {
  it('validates every real content.json on disk and asserts the combined graph is acyclic', async () => {
    let fs: typeof import('node:fs');
    let path: typeof import('node:path');
    try {
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports
      fs = await import('node:fs');
      path = await import('node:path');
    } catch {
      // node:fs unavailable in this runtime — nothing to check.
      return;
    }

    let coursesRoot: string;
    let entries: string[];
    try {
      coursesRoot = path.join(process.cwd(), 'courses');
      entries = fs
        .readdirSync(coursesRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      // courses/ not visible from this runtime — nothing to check.
      return;
    }

    const files: CourseContent[] = [];
    for (const dir of entries) {
      const contentPath = path.join(coursesRoot, dir, 'content.json');
      if (!fs.existsSync(contentPath)) continue;
      const raw = JSON.parse(fs.readFileSync(contentPath, 'utf-8'));
      try {
        files.push(courseContentSchema.parse(raw));
      } catch (err) {
        throw new Error(`content.json validation failed for courses/${dir}/content.json: ${(err as Error).message}`);
      }
    }

    if (files.length === 0) {
      // No content.json files exist yet — nothing to validate.
      return;
    }

    expect(() => resolveContentGraph(files)).not.toThrow();
  });
});
