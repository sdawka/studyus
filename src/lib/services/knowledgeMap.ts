// v1.7 knowledge graph reads: prerequisite traversal, misconceptions,
// scaffolds — all anchored on kc_edges/misconceptions/scaffolds, populated
// from courses/<slug>/content.json by scripts/seed.ts (see docs/api.md's
// "v1.7 Additions" section for the frozen contract these implement).
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { kcEdges, kcs, misconceptions, scaffolds } from '../../db/schema';
import { MASTERY_CONSTANTS } from './mastery';
import { requireOwnedKc } from './util';

export type PrereqNode = {
  kc_id: string;
  slug: string | null;
  name: string;
  kc_type: string;
  mastery: number;
  status: string;
  ready: boolean;
  depth: number;
  prereq_kc_ids: string[];
};

type KcRow = typeof kcs.$inferSelect;
type ScaffoldKind = ScaffoldRow['kind'];
type ScaffoldRow = typeof scaffolds.$inferSelect;
export type MisconceptionRow = typeof misconceptions.$inferSelect;

function isReady(status: string, mastery: number): boolean {
  return status !== 'not-started' && mastery >= MASTERY_CONSTANTS.REVIEW_THRESHOLD;
}

function shapeTargetKc(kc: KcRow) {
  return { id: kc.id, name: kc.name, kc_type: kc.kcType, mastery: kc.mastery, status: kc.status };
}

/**
 * Traverses kc_edges from the target KC outward (kc_id -> prereq_kc_id),
 * i.e. every KC the target depends on, directly or transitively, and
 * everything those depend on in turn — a BFS so `depth` comes out as
 * shortest-hop-count for free.
 *
 * A flat visited set guards termination: it's what makes this cycle-safe.
 * The same set correctly handles a legitimate DAG diamond (a KC reachable
 * via two different parents — kept at its first/shortest depth, never
 * re-processed) without distinguishing it from a true cycle, since either
 * way re-entering an already-discovered node is a no-op. A second DFS
 * coloring pass below, over the full edge set the BFS discovered, tells
 * diamonds and cycles apart and reports only genuine back-edges (a data
 * anomaly that should have been caught at seed-time validation) as
 * `warnings`, rather than throwing.
 */
export async function getKcGraph(db: Db, userId: string, kcId: string) {
  const target = await requireOwnedKc(db, userId, kcId);
  const warnings: string[] = [];

  const visited = new Set<string>([kcId]);
  const depthOf = new Map<string, number>();
  const prereqIdsOf = new Map<string, string[]>();
  const discoveredOrder: string[] = [];

  let frontier = [kcId];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const edgeRows = await db.select().from(kcEdges).where(inArray(kcEdges.kcId, frontier));

    const byKc = new Map<string, string[]>();
    for (const edge of edgeRows) {
      const list = byKc.get(edge.kcId) ?? [];
      list.push(edge.prereqKcId);
      byKc.set(edge.kcId, list);
    }
    for (const node of frontier) prereqIdsOf.set(node, byKc.get(node) ?? []);

    const nextFrontier: string[] = [];
    for (const edge of edgeRows) {
      const prereqId = edge.prereqKcId;
      if (visited.has(prereqId)) continue;
      visited.add(prereqId);
      depthOf.set(prereqId, depth);
      discoveredOrder.push(prereqId);
      nextFrontier.push(prereqId);
    }
    frontier = nextFrontier;
  }

  // Cycle detection: white/gray/black DFS coloring over the discovered edge
  // set (prereqIdsOf has an entry for every visited node — each gets
  // dequeued, and thus recorded, exactly once above). Re-entering a *gray*
  // node is a true back-edge (cycle); re-entering a *black* one is just a
  // diamond already fully explored — not a warning.
  const color = new Map<string, 1 | 2>();
  const dfsCycles = (node: string, path: string[]) => {
    color.set(node, 1);
    for (const next of prereqIdsOf.get(node) ?? []) {
      const c = color.get(next);
      if (c === 1) {
        warnings.push(`Cycle detected in prerequisite graph: ${[...path, next].join(' -> ')}`);
      } else if (c === undefined) {
        dfsCycles(next, [...path, next]);
      }
    }
    color.set(node, 2);
  };
  dfsCycles(kcId, [kcId]);

  if (discoveredOrder.length === 0) {
    return { kc: shapeTargetKc(target), prereqs: [] as PrereqNode[], warnings };
  }

  const rows = await db.select().from(kcs).where(inArray(kcs.id, discoveredOrder));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const prereqs: PrereqNode[] = [];
  for (const id of discoveredOrder) {
    const row = byId.get(id);
    if (!row) {
      // Dangling edge — shouldn't happen (kc_edges cascades on kcs delete),
      // but defensively skip rather than 500 on a stale/inconsistent row.
      warnings.push(`Could not load KC ${id} referenced as a prerequisite`);
      continue;
    }
    prereqs.push({
      kc_id: row.id,
      slug: row.slug,
      name: row.name,
      kc_type: row.kcType,
      mastery: row.mastery,
      status: row.status,
      ready: isReady(row.status, row.mastery),
      depth: depthOf.get(id)!,
      prereq_kc_ids: prereqIdsOf.get(id) ?? [],
    });
  }

  return { kc: shapeTargetKc(target), prereqs, warnings };
}

export async function listKcMisconceptions(db: Db, userId: string, kcId: string): Promise<MisconceptionRow[]> {
  await requireOwnedKc(db, userId, kcId);
  return db.select().from(misconceptions).where(eq(misconceptions.kcId, kcId)).orderBy(asc(misconceptions.createdAt));
}

export async function listKcScaffolds(
  db: Db,
  userId: string,
  kcId: string,
  opts: { kind?: string; maxLevel?: number } = {},
): Promise<ScaffoldRow[]> {
  await requireOwnedKc(db, userId, kcId);

  const conditions = [eq(scaffolds.kcId, kcId)];
  if (opts.kind) conditions.push(eq(scaffolds.kind, opts.kind as ScaffoldKind));
  if (opts.maxLevel !== undefined) conditions.push(lte(scaffolds.level, opts.maxLevel));

  return db.select().from(scaffolds).where(and(...conditions)).orderBy(asc(scaffolds.sortOrder));
}
