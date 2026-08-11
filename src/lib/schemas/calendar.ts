import { z } from 'zod';
import { idSchema, isoDatetimeSchema } from './common';

export const calendarQuerySchema = z.strictObject({
  from: isoDatetimeSchema,
  to: isoDatetimeSchema,
  course: idSchema.optional(),
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
