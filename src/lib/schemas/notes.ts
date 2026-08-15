import { z } from 'zod';
import { idSchema } from './common';

export const noteLinkSchema = z.strictObject({
  course_id: idSchema.optional(),
  kc_id: idSchema.optional(),
});
export type NoteLinkInput = z.infer<typeof noteLinkSchema>;

export const createNoteSchema = z.strictObject({
  title: z.string().min(1).max(300),
  content: z.string().max(50000).default(''),
  links: z.array(noteLinkSchema).optional(),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z.strictObject({
  title: z.string().min(1).max(300).optional(),
  content: z.string().max(50000).optional(),
  links: z.array(noteLinkSchema).optional(),
});
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
