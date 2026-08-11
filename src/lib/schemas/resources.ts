import { z } from 'zod';
import { idSchema } from './common';

export const RESOURCE_KINDS = ['canonical', 'feed', 'user_shared'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const listResourcesQuerySchema = z.strictObject({
  course: idSchema.optional(),
  kind: z.enum(RESOURCE_KINDS).optional(),
});
export type ListResourcesQuery = z.infer<typeof listResourcesQuerySchema>;

// User-added resources are always kind=user_shared; canonical/feed are seed-only.
export const createResourceSchema = z.strictObject({
  url: z.url(),
  label: z.string().min(1),
  course_id: idSchema.optional(),
  kc_id: idSchema.optional(),
});
export type CreateResourceInput = z.infer<typeof createResourceSchema>;
