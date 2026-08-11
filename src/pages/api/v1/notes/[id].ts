import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { updateNoteSchema } from '../../../../lib/schemas/notes';
import { deleteNote, getNote, updateNote } from '../../../../lib/services/notes';

export const GET: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const note = await getNote(db, locals.user!.id, params.id!);
    return apiOk(toApi(note));
  });

export const PATCH: APIRoute = async ({ params, request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = updateNoteSchema.parse(body);
    const db = getDb(env.DB);
    const updated = await updateNote(db, locals.user!.id, params.id!, input);
    return apiOk(toApi(updated));
  });

export const DELETE: APIRoute = async ({ params, locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    await deleteNote(db, locals.user!.id, params.id!);
    return apiOk({});
  });
