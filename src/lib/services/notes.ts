import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, kcs, noteLinks, notes } from '../../db/schema';
import type { CreateNoteInput, UpdateNoteInput } from '../schemas/notes';
import { NotFoundError, requireOwnedCourse, requireOwnedKc } from './util';

// The `content` field name in the frozen contract maps to the `body` column
// (named for its markdown-body role internally); shape the response here so
// the route layer never has to know about that internal naming.
function shapeNote(note: typeof notes.$inferSelect) {
  const { body, ...rest } = note;
  return { ...rest, content: body };
}

export async function listNotes(db: Db, userId: string) {
  const rows = await db.select().from(notes).where(eq(notes.userId, userId)).orderBy(desc(notes.updatedAt));
  const links = rows.length
    ? await db
        .select({
          noteId: noteLinks.noteId,
          courseId: noteLinks.courseId,
          kcId: noteLinks.kcId,
          courseCode: courses.code,
          kcName: kcs.name,
        })
        .from(noteLinks)
        .innerJoin(notes, eq(noteLinks.noteId, notes.id))
        .leftJoin(courses, eq(noteLinks.courseId, courses.id))
        .leftJoin(kcs, eq(noteLinks.kcId, kcs.id))
        .where(eq(notes.userId, userId))
    : [];
  const byNote = new Map<string, { course_id?: string; kc_id?: string; label?: string }[]>();
  for (const l of links) {
    const list = byNote.get(l.noteId) ?? [];
    list.push({
      course_id: l.courseId ?? undefined,
      kc_id: l.kcId ?? undefined,
      label: l.kcName ?? l.courseCode ?? undefined,
    });
    byNote.set(l.noteId, list);
  }
  return rows.map((row) => ({ ...shapeNote(row), links: byNote.get(row.id) ?? [] }));
}

// Ownership guard (mirrors resources.ts's create-time checks): a course_id or
// kc_id supplied by the client must belong to `userId`, or the whole request
// 404s — otherwise a note could be linked into another user's course/KC.
// Split from the actual write (below) so both call sites can validate
// *before* mutating anything — createNote before the note row even exists,
// updateNote before its old links are torn down — so a foreign id 404s
// without leaving an orphaned note or a wiped link set behind.
async function requireLinksOwned(db: Db, userId: string, links: CreateNoteInput['links']) {
  const valid = (links ?? []).filter((l) => l.course_id || l.kc_id);
  await Promise.all(
    valid.map(async (l) => {
      if (l.course_id) await requireOwnedCourse(db, userId, l.course_id);
      if (l.kc_id) await requireOwnedKc(db, userId, l.kc_id);
    }),
  );
  return valid;
}

async function writeLinks(db: Db, noteId: string, validLinks: { course_id?: string; kc_id?: string }[]) {
  if (!validLinks.length) return;
  await db.insert(noteLinks).values(
    validLinks.map((l) => ({ id: crypto.randomUUID(), noteId, courseId: l.course_id ?? null, kcId: l.kc_id ?? null })),
  );
}

export async function createNote(db: Db, userId: string, input: CreateNoteInput) {
  const validLinks = await requireLinksOwned(db, userId, input.links);

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(notes).values({ id, userId, title: input.title, body: input.content ?? '', createdAt: now, updatedAt: now });
  await writeLinks(db, id, validLinks);
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

  const validLinks = input.links !== undefined ? await requireLinksOwned(db, userId, input.links) : null;

  const patch: Partial<typeof notes.$inferInsert> = { updatedAt: Date.now() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.content !== undefined) patch.body = input.content;
  await db.update(notes).set(patch).where(eq(notes.id, noteId));

  if (validLinks !== null) {
    await db.delete(noteLinks).where(eq(noteLinks.noteId, noteId));
    await writeLinks(db, noteId, validLinks);
  }

  return getNote(db, userId, noteId);
}

export async function deleteNote(db: Db, userId: string, noteId: string) {
  await requireOwnedNote(db, userId, noteId);
  await db.delete(notes).where(eq(notes.id, noteId));
}
