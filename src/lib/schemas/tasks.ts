import { z } from 'zod';
import { idSchema, isoDatetimeSchema } from './common';

// Task-centric platform (v1.4): 'todo' is the only type a user can mint
// directly (see createTaskSchema below — no `type` field on create/update).
// The rest are sweep-generated only (services/taskSweep.ts), which
// guarantees every non-todo row carries a dedupe key.
export const TASK_TYPES = [
  'todo',
  'attend_class',
  'prep_before_class',
  'review_after_class',
  'practice_kc',
  'stale_kc',
  'grade_entry',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const createTaskSchema = z.strictObject({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  due_date: isoDatetimeSchema.optional(),
  course_ids: z.array(idSchema).optional(),
  // Create-only: one level of subtasks (parent must not itself have a
  // parent — enforced in services/tasks.ts, not here, since it requires a
  // DB lookup).
  parent_task_id: idSchema.optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.strictObject({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).nullable().optional(),
  due_date: isoDatetimeSchema.nullable().optional(),
  completed: z.boolean().optional(),
  course_ids: z.array(idSchema).optional(),
  // v1.6: a short recap attachable when completing any task (not just
  // attend_class) — see CompletionFlow.svelte / toggleTask's completionNote
  // option. Independent of `completed`; can be set/cleared on its own.
  completion_note: z.string().max(2000).nullable().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
