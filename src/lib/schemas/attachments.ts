// Attachment metadata is created from a multipart upload (no JSON body to
// validate against a Zod schema beyond checking the `file` field exists),
// but we keep a schema here for the shape returned to clients.
import { z } from 'zod';

export const attachmentSchema = z.strictObject({
  id: z.uuid(),
  r2_key: z.string(),
  filename: z.string(),
  content_type: z.string().nullable(),
  size_bytes: z.number().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
