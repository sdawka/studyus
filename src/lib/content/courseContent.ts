// Pure content-pipeline module for courses/<slug>/content.json (frozen
// contract: courses/content-schema.md, schema_version 1). No
// cloudflare/server-only imports — this must be importable from both
// scripts/seed.ts (plain Node/tsx) and vitest (workerd pool).
import { z } from 'zod';

export const CONTENT_KC_TYPES = ['fact', 'association', 'concept', 'rule', 'principle'] as const;
export type ContentKcType = (typeof CONTENT_KC_TYPES)[number];

export const CONTENT_SCAFFOLD_KINDS = [
  'retrieval_prompt',
  'mnemonic',
  'matching_drill',
  'classification_task',
  'contrast_examples',
  'worked_example',
  'procedure_outline',
  'self_explanation_prompt',
  'derivation_walkthrough',
  'interactive_model',
  'analogy',
] as const;
export type ContentScaffoldKind = (typeof CONTENT_SCAFFOLD_KINDS)[number];

// user_shared is runtime-only (never seeded) — content.json resources are
// always canonical or feed, per courses/content-schema.md's Resource section.
export const CONTENT_RESOURCE_KINDS = ['canonical', 'feed'] as const;
export type ContentResourceKind = (typeof CONTENT_RESOURCE_KINDS)[number];

export const CONTENT_ASSESSMENT_TYPES = ['quiz', 'assignment', 'midterm', 'final', 'lab'] as const;
export type ContentAssessmentType = (typeof CONTENT_ASSESSMENT_TYPES)[number];

export const CONTENT_ASSESSMENT_KINDS = ['official', 'practice'] as const;
export type ContentAssessmentKind = (typeof CONTENT_ASSESSMENT_KINDS)[number];

// kebab-case, lowercase alnum segments joined by single hyphens.
const slugRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// A KC reference: "#kc-slug" (same course) or "other-slug#kc-slug"
// (cross-course) — see courses/content-schema.md's KC.prereqs section.
const kcRefRegex = /^([a-z0-9]+(-[a-z0-9]+)*)?#[a-z0-9]+(-[a-z0-9]+)*$/;
const kcRefSchema = z.string().regex(kcRefRegex, 'Expected "#kc-slug" or "other-course-slug#kc-slug"');

export const contentResourceSchema = z.strictObject({
  label: z.string().min(1),
  url: z.url(),
  kind: z.enum(CONTENT_RESOURCE_KINDS),
  pinned: z.boolean().optional().default(false),
});
export type ContentResource = z.infer<typeof contentResourceSchema>;

export const contentScaffoldSchema = z.strictObject({
  kind: z.enum(CONTENT_SCAFFOLD_KINDS),
  // 1 = high support, 2 = medium, 3 = low/independent.
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().min(1),
  body: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional().default({}),
});
export type ContentScaffold = z.infer<typeof contentScaffoldSchema>;

export const contentMisconceptionSchema = z.strictObject({
  slug: z.string().regex(slugRegex),
  name: z.string().min(1),
  description: z.string().min(1),
  root_cause: z.string().min(1),
  diagnostic_probe: z.string().min(1),
  correction: z.string().min(1),
});
export type ContentMisconception = z.infer<typeof contentMisconceptionSchema>;

export const contentKcSchema = z.strictObject({
  slug: z.string().regex(slugRegex),
  name: z.string().min(1),
  kc_type: z.enum(CONTENT_KC_TYPES),
  description: z.string().min(1),
  practice_notes: z.string().min(1),
  sort_order: z.number().int(),
  prereqs: z.array(kcRefSchema).optional().default([]),
  resources: z.array(contentResourceSchema).optional().default([]),
  scaffolds: z.array(contentScaffoldSchema).optional().default([]),
  misconceptions: z.array(contentMisconceptionSchema).optional().default([]),
});
export type ContentKc = z.infer<typeof contentKcSchema>;

export const contentBranchSchema = z.strictObject({
  slug: z.string().regex(slugRegex),
  name: z.string().min(1),
  sort_order: z.number().int(),
  kcs: z.array(contentKcSchema).min(1),
});
export type ContentBranch = z.infer<typeof contentBranchSchema>;

export const contentAssessmentSchema = z.strictObject({
  title: z.string().min(1),
  type: z.enum(CONTENT_ASSESSMENT_TYPES),
  kind: z.enum(CONTENT_ASSESSMENT_KINDS),
  weight_pct: z.number().min(0).max(100).optional(),
  due_date: z.iso.date().optional(),
  kc_slugs: z.array(kcRefSchema).optional().default([]),
});
export type ContentAssessment = z.infer<typeof contentAssessmentSchema>;

export const courseContentSchema = z.strictObject({
  schema_version: z.literal(1),
  course_slug: z.string().regex(slugRegex),
  branches: z.array(contentBranchSchema).min(1),
  course_resources: z.array(contentResourceSchema).optional().default([]),
  assessments: z.array(contentAssessmentSchema).optional().default([]),
});
export type CourseContent = z.infer<typeof courseContentSchema>;

// ---------------------------------------------------------------------------
// Graph resolution
// ---------------------------------------------------------------------------

export type ResolvedKcRef = { courseSlug: string; kcSlug: string; key: string };

/** Resolves a "#kc-slug" or "other-slug#kc-slug" ref to a catalog key. */
export function parseKcRef(ref: string, currentCourseSlug: string): ResolvedKcRef {
  const hashIdx = ref.indexOf('#');
  const rawCourseSlug = hashIdx <= 0 ? currentCourseSlug : ref.slice(0, hashIdx);
  const kcSlug = ref.slice(hashIdx + 1);
  return { courseSlug: rawCourseSlug, kcSlug, key: `${rawCourseSlug}#${kcSlug}` };
}

export type ResolvedKcEntry = {
  key: string; // `${courseSlug}#${kcSlug}`
  courseSlug: string;
  branchSlug: string;
  kcSlug: string;
  kc: ContentKc;
};

export type ResolvedEdge = { kcKey: string; prereqKcKey: string };

export type ResolvedAssessmentKcLink = {
  courseSlug: string;
  assessmentIndex: number;
  kcKey: string;
};

export type ContentGraph = {
  kcCatalog: Map<string, ResolvedKcEntry>;
  edges: ResolvedEdge[];
  assessmentLinks: ResolvedAssessmentKcLink[];
  warnings: string[];
};

/**
 * Builds the cross-course KC catalog, resolves prereq refs into edges and
 * assessment kc_slugs into links, and detects cycles across the combined
 * graph (throws with the cycle path). Unresolvable refs are skipped with a
 * warning rather than failing — content authors may reference KCs from
 * non-seeded courses, which the caller should surface but not abort on.
 */
export function resolveContentGraph(files: CourseContent[]): ContentGraph {
  const kcCatalog = new Map<string, ResolvedKcEntry>();

  for (const file of files) {
    for (const branch of file.branches) {
      for (const kc of branch.kcs) {
        const key = `${file.course_slug}#${kc.slug}`;
        kcCatalog.set(key, { key, courseSlug: file.course_slug, branchSlug: branch.slug, kcSlug: kc.slug, kc });
      }
    }
  }

  const warnings: string[] = [];
  const edges: ResolvedEdge[] = [];

  for (const file of files) {
    for (const branch of file.branches) {
      for (const kc of branch.kcs) {
        const kcKey = `${file.course_slug}#${kc.slug}`;
        for (const ref of kc.prereqs) {
          const { key: prereqKey } = parseKcRef(ref, file.course_slug);
          if (prereqKey === kcKey) {
            warnings.push(`KC "${kcKey}" lists itself as a prereq ("${ref}") — skipped.`);
            continue;
          }
          if (!kcCatalog.has(prereqKey)) {
            warnings.push(`Unresolvable prereq ref "${ref}" on KC "${kcKey}" (target "${prereqKey}" not found) — skipped.`);
            continue;
          }
          edges.push({ kcKey, prereqKcKey: prereqKey });
        }
      }
    }
  }

  detectCycle(kcCatalog, edges);

  const assessmentLinks: ResolvedAssessmentKcLink[] = [];
  for (const file of files) {
    file.assessments.forEach((assessment, assessmentIndex) => {
      for (const ref of assessment.kc_slugs) {
        const { key } = parseKcRef(ref, file.course_slug);
        if (!kcCatalog.has(key)) {
          warnings.push(
            `Unresolvable kc_slugs ref "${ref}" on assessment "${assessment.title}" (course "${file.course_slug}") — skipped.`,
          );
          continue;
        }
        assessmentLinks.push({ courseSlug: file.course_slug, assessmentIndex, kcKey: key });
      }
    });
  }

  return { kcCatalog, edges, assessmentLinks, warnings };
}

// Edge direction is "kcKey depends on prereqKcKey". A cycle means some KC
// transitively depends on itself — throws with the full cycle path.
function detectCycle(kcCatalog: Map<string, ResolvedKcEntry>, edges: ResolvedEdge[]): void {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.kcKey) ?? [];
    list.push(edge.prereqKcKey);
    adjacency.set(edge.kcKey, list);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const path: string[] = [];

  function visit(node: string): void {
    color.set(node, GRAY);
    path.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const state = color.get(next) ?? WHITE;
      if (state === GRAY) {
        const cycleStart = path.indexOf(next);
        const cyclePath = [...path.slice(cycleStart), next];
        throw new Error(`Cycle detected in KC prerequisite graph: ${cyclePath.join(' -> ')}`);
      }
      if (state === WHITE) visit(next);
    }
    path.pop();
    color.set(node, BLACK);
  }

  for (const key of kcCatalog.keys()) {
    if ((color.get(key) ?? WHITE) === WHITE) visit(key);
  }
}
