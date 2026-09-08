import { z } from 'zod';

const availabilityEntry = z.strictObject({
  day: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
}).refine((entry) => entry.startMinute < entry.endMinute, 'Availability must end after it starts');

export const planningPreferencesSchema = z.strictObject({
  enabled: z.boolean(),
  weeklyMinutes: z.number().int().min(0).max(10_080),
  availability: z.array(availabilityEntry).max(64),
  timezone: z.string().min(1).max(100).refine((timezone) => {
    try { new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(); return true; }
    catch { return false; }
  }, 'Use an IANA time zone'),
  expectedRevision: z.number().int().min(0),
}).superRefine((input, context) => {
  if (input.enabled && input.availability.length === 0) {
    context.addIssue({ code: 'custom', path: ['availability'], message: 'Add a study window before enabling automatic planning' });
  }
});

export const planningApplySchema = z.strictObject({
  sourceRevision: z.number().int().min(0),
});
