import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, kcs, noteLinks, notes, users } from '../src/db/schema';
import { createNote, deleteNote, getNote, listNotes, updateNote } from '../src/lib/services/notes';
import { NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);
let userId: string;
let otherUserId: string;
let courseId: string;
let kcId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  otherUserId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values([
    { id: userId, email: `${userId}@test.local`, passwordHash: 'x' },
    { id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' },
  ]);
  await db.insert(courses).values({ id: courseId, userId, code: 'OWN 101', slug: `own-${courseId}`, title: 'Own' });
  const branchId = crypto.randomUUID();
  kcId = crypto.randomUUID();
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'KC' });
});

describe('notes lifecycle', () => {
  it('creates, reads, lists, updates content and replaces links', async () => {
    const note = await createNote(db, userId, { title: 'First', content: 'Body', links: [{ course_id: courseId }] });
    expect(await getNote(db, userId, note.id)).toMatchObject({ title: 'First', content: 'Body', links: [{ course_id: courseId, kc_id: null }] });
    const updated = await updateNote(db, userId, note.id, { title: 'Updated', content: '', links: [{ kc_id: kcId }] });
    expect(updated).toMatchObject({ title: 'Updated', content: '', links: [{ course_id: null, kc_id: kcId }] });
    expect((await listNotes(db, userId)).map((n) => n.id)).toContain(note.id);
    const contentOnly = await updateNote(db, userId, note.id, { content: 'Again' });
    expect(contentOnly.links).toEqual([{ course_id: null, kc_id: kcId }]);
    await createNote(db, otherUserId, { title: 'Private', content: 'Secret' });
    const listed = await listNotes(db, userId);
    expect(listed.map((item) => item.id)).toEqual([note.id]);
    expect(listed[0]).toMatchObject({ content: 'Again', links: [{ kc_id: kcId }] });
  });

  it('clears links when updated with an empty array', async () => {
    const note = await createNote(db, userId, { title: 'First', content: '', links: [{ course_id: courseId }] });
    await updateNote(db, userId, note.id, { links: [] });
    expect(await db.select().from(noteLinks).where(eq(noteLinks.noteId, note.id))).toHaveLength(0);
  });

  it('rejects foreign note access and deletes owned notes with links', async () => {
    const note = await createNote(db, userId, { title: 'First', content: '', links: [{ kc_id: kcId }] });
    await expect(getNote(db, otherUserId, note.id)).rejects.toThrow(NotFoundError);
    await deleteNote(db, userId, note.id);
    expect(await db.select().from(notes).where(eq(notes.id, note.id))).toHaveLength(0);
    expect(await db.select().from(noteLinks).where(eq(noteLinks.noteId, note.id))).toHaveLength(0);
  });

  it('rejects foreign update and delete without changing the note', async () => {
    const note = await createNote(db, userId, { title: 'First', content: 'Body', links: [{ kc_id: kcId }] });
    await expect(updateNote(db, otherUserId, note.id, { title: 'Changed', links: [] })).rejects.toThrow(NotFoundError);
    await expect(deleteNote(db, otherUserId, note.id)).rejects.toThrow(NotFoundError);
    expect(await getNote(db, userId, note.id)).toMatchObject({ title: 'First', content: 'Body', links: [{ course_id: null, kc_id: kcId }] });
  });

  it('rejects missing note reads, updates, and deletes', async () => {
    const missing = crypto.randomUUID();
    await expect(getNote(db, userId, missing)).rejects.toThrow(NotFoundError);
    await expect(updateNote(db, userId, missing, { title: 'Nope' })).rejects.toThrow(NotFoundError);
    await expect(deleteNote(db, userId, missing)).rejects.toThrow(NotFoundError);
  });
});
