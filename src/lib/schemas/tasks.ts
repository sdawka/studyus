import { z } from 'zod';
import { idSchema, isoDatetimeSchema } from './common';

export const createTaskSchema = z.strictObject({
  title: z.string().min(1),
  description: z.string().optional(),
  due_date: isoDatetimeSchema.optional(),
  course_ids: z.array(idSchema).optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.strictObject({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  due_date: isoDatetimeSchema.nullable().optional(),
  completed: z.boolean().optional(),
  course_ids: z.array(idSchema).optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
