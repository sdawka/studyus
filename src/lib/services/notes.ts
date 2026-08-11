import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { noteLinks, notes } from '../../db/schema';
import type { CreateNoteInput, UpdateNoteInput } from '../schemas/notes';
import { NotFoundError } from './util';

// The `content` field name in the frozen contract maps to the `body` column
// (named for its markdown-body role internally); shape the response here so
// the route layer never has to know about that internal naming.
function shapeNote(note: typeof notes.$inferSelect) {
  const { body, ...rest } = note;
  return { ...rest, content: body };
}

export async function listNotes(db: Db, userId: string) {
  const rows = await db.select().from(notes).where(eq(notes.userId, userId)).orderBy(desc(notes.updatedAt));
  return rows.map(shapeNote);
}

async function insertLinks(db: Db, noteId: string, links: CreateNoteInput['links']) {
  if (!links?.length) return;
  await db.insert(noteLinks).values(
    links
      .filter((l) => l.course_id || l.kc_id)
      .map((l) => ({ id: crypto.randomUUID(), noteId, courseId: l.course_id ?? null, kcId: l.kc_id ?? null })),
  );
}

export async function createNote(db: Db, userId: string, input: CreateNoteInput) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(notes).values({ id, userId, title: input.title, body: input.content ?? '', createdAt: now, updatedAt: now });
  await insertLinks(db, id, input.links);
  return getNote(db, userId, id);
}

async function requireOwnedNote(db: Db, userId: string, noteId: string) {
  const rows = await db.select().from(notes).where(and(eq(notes.id, noteId), eq(notes.userId, userId))).limit(1);
  const note = rows[0];
  if (!note) throw new NotFoundError('Note');
  return note;
}

export async function getNote(db: Db, userId: string, noteId: string) {
  const note = await requireOwnedNote(db, userId, noteId);
  const links = await db.select().from(noteLinks).where(eq(noteLinks.noteId, noteId));
  return { ...shapeNote(note), links: links.map((l) => ({ course_id: l.courseId, kc_id: l.kcId })) };
}

export async function updateNote(db: Db, userId: string, noteId: string, input: UpdateNoteInput) {
  await requireOwnedNote(db, userId, noteId);

  const patch: Partial<typeof notes.$inferInsert> = { updatedAt: Date.now() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.content !== undefined) patch.body = input.content;
  await db.update(notes).set(patch).where(eq(notes.id, noteId));

  if (input.links !== undefined) {
    await db.delete(noteLinks).where(eq(noteLinks.noteId, noteId));
    await insertLinks(db, noteId, input.links);
  }

  return getNote(db, userId, noteId);
}

export async function deleteNote(db: Db, userId: string, noteId: string) {
  await requireOwnedNote(db, userId, noteId);
  await db.delete(notes).where(eq(notes.id, noteId));
}
