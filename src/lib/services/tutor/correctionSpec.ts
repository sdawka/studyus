// Correction-proposal spec: parser for the fenced ```json block an absorb
// conversation's assistant turn may emit when the dialogue has surfaced a
// misconception (see docs/api.md's "Correction proposals" section, v1.7).
// Mirrors modelSpec.ts's "degrade gracefully" pattern — any failure (no
// block, invalid JSON, schema mismatch) returns `null` and the message
// still renders fine as plain prose.
//
// Unlike modelSpec.ts's extractModelSpec (which takes the *first* fenced
// json block unconditionally), this scans *every* fenced json block in the
// message and returns the first one that actually validates as a
// correction_proposal. A single assistant turn may carry both an
// interactive_model block and a correction_proposal block (per the api.md
// note that a turn "could in principle carry both"), in either order — this
// module only cares about the one whose `type` tag matches its own shape.
//
// This module has no server-only imports (no drizzle/cloudflare), matching
// modelSpec.ts, so a client component could import `extractCorrectionProposal`
// directly to render the accept/dismiss affordance without a round-trip.
import { z } from 'zod';

export const correctionProposalSchema = z.object({
  type: z.literal('correction_proposal'),
  misconception_slug: z.string().min(1).optional(),
  prior_belief: z.string().min(1),
  correction: z.string().min(1),
});

export type CorrectionProposal = z.infer<typeof correctionProposalSchema>;

const FENCED_JSON_BLOCK = /```json\s*([\s\S]*?)```/gi;

/** Scans every fenced ```json block in `text` and returns the first one that
 *  parses and validates as a correction_proposal. Returns `null` if there is
 *  no such block, or every candidate block fails to parse/validate (e.g. the
 *  message only carries an interactive_model block, or malformed JSON). */
export function extractCorrectionProposal(text: string): CorrectionProposal | null {
  for (const match of text.matchAll(FENCED_JSON_BLOCK)) {
    try {
      const raw = JSON.parse(match[1]);
      const parsed = correctionProposalSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
    } catch {
      // Not valid JSON in this particular block — keep scanning; another
      // fenced block in the same message (e.g. an interactive_model spec)
      // may come before or after a valid correction_proposal.
    }
  }
  return null;
}
