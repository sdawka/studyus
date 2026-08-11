import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { updateTaskSchema } from '../../../../lib/schemas/tasks';
import { deleteTask, updateTask } from '../../../../lib/services/tasks';

export const PATCH: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = updateTaskSchema.parse(body);
    const db = getDb(env.DB);
    const updated = await updateTask(db, locals.user!.id, params.id!, input);
    return apiOk(toApi(updated));
  });

export const DELETE: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    await deleteTask(db, locals.user!.id, params.id!);
    return apiOk({});
  });
