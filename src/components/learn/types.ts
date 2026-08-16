// Shared shapes for the /learn absorb experience — mirrors the frozen
// GET /kcs/:id/graph response documented in docs/api.md's v1.7 section.
// `kc_type`/`status` are kept as plain `string` (not narrower literal
// unions) to match src/lib/services/knowledgeMap.ts's own `PrereqNode`
// export exactly, since that's the type actually flowing through the
// GET /kcs/:id/graph route this data comes from.
export interface TargetKc {
  id: string;
  name: string;
  kc_type: string;
  mastery: number;
  status: string;
}

export interface PrereqNode {
  kc_id: string;
  slug: string | null;
  name: string;
  kc_type: string;
  mastery: number;
  status: string;
  ready: boolean;
  depth: number;
  prereq_kc_ids: string[];
}

export interface KcGraph {
  kc: TargetKc;
  prereqs: PrereqNode[];
  warnings: string[];
}
