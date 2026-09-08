import { z } from 'zod';
import { safeWebUrl } from '../webUrl';

export const MAX_GROUP_MEMBERS = 25;
export const MAX_OWNED_GROUPS = 5;
export const GROUP_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_GROUP_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_GROUP_FILE_COUNT = 100;
export const MAX_GROUP_STORAGE_BYTES = 250 * 1024 * 1024;

export const createGroupSchema = z.strictObject({ name: z.string().trim().min(1).max(100) });
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const createGroupInvitationSchema = z.strictObject({ email: z.string().trim().max(320).pipe(z.email()) });
export const acceptGroupInvitationSchema = z.strictObject({ token: z.string().min(1).max(512) });

export const createGroupResourceSchema = z.strictObject({
  label: z.string().trim().min(1).max(200),
  url: z.string().max(2048).refine((value) => safeWebUrl(value) !== null, 'Use an HTTP or HTTPS URL without embedded credentials.'),
});
export type CreateGroupResourceInput = z.infer<typeof createGroupResourceSchema>;
export const updateGroupResourceSchema = z.strictObject({
  label: z.string().trim().min(1).max(200).optional(),
  url: z.string().max(2048).refine((value) => safeWebUrl(value) !== null, 'Use an HTTP or HTTPS URL without embedded credentials.').optional(),
}).refine((value) => value.label !== undefined || value.url !== undefined, 'Provide label or url');
export type UpdateGroupResourceInput = z.infer<typeof updateGroupResourceSchema>;

const groupEventFields = z.strictObject({
  title: z.string().trim().min(1).max(200),
  startsAt: z.number().int().nonnegative(),
  endsAt: z.number().int().positive(),
  timezone: z.string().trim().min(1).max(100),
});
export const createGroupEventSchema = groupEventFields.refine((value) => value.endsAt > value.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });
export type CreateGroupEventInput = z.infer<typeof createGroupEventSchema>;
export const updateGroupEventSchema = groupEventFields.partial().refine((value) => Object.keys(value).length > 0, 'Provide at least one event field');
export type UpdateGroupEventInput = z.infer<typeof updateGroupEventSchema>;

export const createGroupEventApiSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
  timezone: z.string().trim().min(1).max(100),
}).transform((value, context) => {
  const startsAt = Date.parse(value.starts_at);
  const endsAt = Date.parse(value.ends_at);
  if (endsAt <= startsAt) {
    context.addIssue({ code: 'custom', message: 'ends_at must be after starts_at', path: ['ends_at'] });
    return z.NEVER;
  }
  return { title: value.title, startsAt, endsAt, timezone: value.timezone };
});

export const updateGroupEventApiSchema = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  starts_at: z.iso.datetime({ offset: true }).optional(),
  ends_at: z.iso.datetime({ offset: true }).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one event field').transform((value) => ({
  ...(value.title !== undefined ? { title: value.title } : {}),
  ...(value.starts_at !== undefined ? { startsAt: Date.parse(value.starts_at) } : {}),
  ...(value.ends_at !== undefined ? { endsAt: Date.parse(value.ends_at) } : {}),
  ...(value.timezone !== undefined ? { timezone: value.timezone } : {}),
}));

export const copyGroupFileSchema = z.strictObject({ attachment_id: z.string().uuid() });

export const GROUP_RSVP_RESPONSES = ['going', 'maybe', 'declined'] as const;
export const groupRsvpSchema = z.strictObject({ response: z.enum(GROUP_RSVP_RESPONSES) });
export type GroupRsvpResponse = (typeof GROUP_RSVP_RESPONSES)[number];
