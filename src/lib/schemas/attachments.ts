// Attachment metadata is created from a multipart upload (no JSON body to
// validate against a Zod schema beyond checking the `file` field exists),
// but we keep a schema here for the shape returned to clients.
import { z } from 'zod';

// Enforced from actual multipart stream bytes in the upload route before a
// bounded File is passed to the lifecycle service.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ACCOUNT_ATTACHMENT_BYTES = 250 * 1024 * 1024; // 250 MB
export const MAX_ACCOUNT_ATTACHMENT_COUNT = 100;
export const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export const attachmentSchema = z.strictObject({
  id: z.uuid(),
  r2_key: z.string(),
  filename: z.string(),
  content_type: z.string().nullable(),
  size_bytes: z.number().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
