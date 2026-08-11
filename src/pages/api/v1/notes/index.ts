import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { createNoteSchema } from '../../../../lib/schemas/notes';
import { createNote, listNotes } from '../../../../lib/services/notes';

export const GET: APIRoute = async ({ locals }) =>
  withServiceErrors(async () => {
    const db = getDb(env.DB);
    const rows = await listNotes(db, locals.user!.id);
    return apiOk(toApi(rows));
  });

export const POST: APIRoute = async ({ request, locals }) =>
  withServiceErrors(async () => {
    const body = await request.json().catch(() => ({}));
    const input = createNoteSchema.parse(body);
    const db = getDb(env.DB);
    const created = await createNote(db, locals.user!.id, input);
    return apiOk(toApi(created), { status: 201 });
  });
