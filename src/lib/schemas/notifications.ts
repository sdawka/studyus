import { z } from 'zod';
import { idSchema } from './common';

export const NOTIFICATION_TYPES = [
  'assessment_due',
  'task_overdue',
  'kc_review',
  'session_unfinished',
  'grade_recorded',
  'correction_review',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const listNotificationsQuerySchema = z.strictObject({
  unread: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const createNotificationInputSchema = z.strictObject({
  userId: z.string(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string().min(1),
  body: z.string().optional(),
  courseId: idSchema.optional(),
  href: z.string().min(1),
  dedupeKey: z.string().min(1),
});
export type CreateNotificationInput = z.infer<typeof createNotificationInputSchema>;
