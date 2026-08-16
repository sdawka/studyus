import { z } from 'zod';

// v1.7 — mirrors the `kind` enum on the `scaffolds` table (src/db/schema.ts).
export const SCAFFOLD_KINDS = [
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
export type ScaffoldKind = (typeof SCAFFOLD_KINDS)[number];

// GET /kcs/:id/scaffolds — `max_level` is an inclusive upper bound (e.g. 2
// returns level 1 and 2 scaffolds, not just level 2).
export const listKcScaffoldsQuerySchema = z.strictObject({
  kind: z.enum(SCAFFOLD_KINDS).optional(),
  max_level: z.coerce.number().int().min(1).max(3).optional(),
});
export type ListKcScaffoldsQuery = z.infer<typeof listKcScaffoldsQuerySchema>;
