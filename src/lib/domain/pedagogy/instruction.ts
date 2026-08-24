// Instruction engine.  It prepares deterministic, learner-grounded teaching
// material; the caller may ask an LLM to narrate it, but selection itself is
// never agentic.
import { z } from 'zod';
import type { DomainContext } from '../context';
import { getKcGraph, listKcScaffolds } from '../../services/knowledgeMap';
import { requireOwnedKc } from '../../services/util';

export const instructionModeSchema = z.enum(['socratic', 'analogy_example', 'spoonfeed', 'prereq_gap_filler']);
export type InstructionMode = z.infer<typeof instructionModeSchema>;

export async function prepareInstruction(ctx: DomainContext, input: { kc_id: string; mode: InstructionMode }) {
  const kc = await requireOwnedKc(ctx.db, ctx.userId, input.kc_id);
  const [graph, scaffolds] = await Promise.all([
    getKcGraph(ctx.db, ctx.userId, kc.id),
    listKcScaffolds(ctx.db, ctx.userId, kc.id),
  ]);
  const weakPrereq = [...graph.prereqs].filter((node) => !node.ready).sort((a, b) => a.mastery - b.mastery)[0] ?? null;
  const maxLevel = input.mode === 'spoonfeed' ? 1 : input.mode === 'socratic' ? 3 : 2;

  return {
    kc,
    mode: input.mode,
    // prereq_gap_filler intentionally names the actual blocker instead of
    // making a vague mastery adjustment on the target KC.
    target_kc_id: input.mode === 'prereq_gap_filler' && weakPrereq ? weakPrereq.kc_id : kc.id,
    weak_prerequisite: weakPrereq,
    scaffolds: scaffolds.filter((scaffold) => scaffold.level <= maxLevel),
  };
}
