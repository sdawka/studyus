// Pure ZPD (zone of proximal development) selector: which unmastered KCs a
// learner is ready to tackle next. Mirrors understandNext.ts's style — a
// plain function over caller-supplied rows, no db/fetch here.
//
// Frontier = unmastered KCs whose *every* prerequisite is ready (vacuously
// true for a KC with no prereqs at all). Blocked = unmastered KCs with at
// least one unready prerequisite. Mastered KCs are excluded from both.
//
// A prereq id that isn't present in the input array at all (e.g. a
// cross-course prereq the caller didn't load) is treated as not ready —
// callers that need cross-course gating must include those KCs in the
// input themselves (see services/zpd.ts::getCourseReadiness's one-hop
// out-of-course load).
import { isReady } from './services/knowledgeMap';

export interface ZpdKc {
  id: string;
  status: string;
  mastery: number;
  // Ids of this KC's prerequisites (kc_edges: this kc -> prereq), whatever
  // course they belong to.
  prereqIds: string[];
}

export function computeReadiness(kcs: ZpdKc[]): Map<string, boolean> {
  const readiness = new Map<string, boolean>();
  for (const kc of kcs) readiness.set(kc.id, isReady(kc.status, kc.mastery));
  return readiness;
}

export interface FrontierResult<T extends ZpdKc> {
  frontier: T[];
  blocked: T[];
}

export function selectFrontier<T extends ZpdKc>(kcs: T[]): FrontierResult<T> {
  const readiness = computeReadiness(kcs);

  const frontier: T[] = [];
  const blocked: T[] = [];
  for (const kc of kcs) {
    if (kc.status === 'mastered') continue;
    const allPrereqsReady = kc.prereqIds.every((id) => readiness.get(id) ?? false);
    (allPrereqsReady ? frontier : blocked).push(kc);
  }
  return { frontier, blocked };
}
