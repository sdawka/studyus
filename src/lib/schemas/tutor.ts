import { z } from 'zod';
import { idSchema } from './common';

// Mirrors the `tutor_conversations.mode` enum in db/schema.ts.
export const TUTOR_MODES = ['recall', 'classify', 'worked_example', 'self_explain', 'interactive_model', 'absorb'] as const;
export type TutorMode = (typeof TUTOR_MODES)[number];

// v1.7: absorb-flow extras carried on tutor_conversations.details —
// { flow: 'absorb', focus_order: [kcId, ...] }. Loose/optional throughout so
// non-absorb conversations can omit `details` entirely.
export const conversationDetailsSchema = z.strictObject({
  flow: z.literal('absorb').optional(),
  focus_order: z.array(idSchema).optional(),
});
export type ConversationDetailsInput = z.infer<typeof conversationDetailsSchema>;

export const createConversationSchema = z.strictObject({
  kc_id: idSchema,
  // Optional override of the kc_type-derived default (e.g. a principle KC
  // defaulting to interactive_model can be started as self_explain instead).
  mode: z.enum(TUTOR_MODES).optional(),
  details: conversationDetailsSchema.optional(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const postMessageSchema = z.strictObject({
  content: z.string().min(1).max(4000),
});
export type PostMessageInput = z.infer<typeof postMessageSchema>;

export const endConversationSchema = z.strictObject({
  final_rating: z.number().int().min(1).max(5).optional(),
});
export type EndConversationInput = z.infer<typeof endConversationSchema>;

export const listConversationsQuerySchema = z.strictObject({
  course: idSchema.optional(),
  kc: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
