import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { kcs } from '../../db/schema';
import type { UpdateKcInput } from '../schemas/kcs';
import { requireOwnedKc } from './util';

export async function getKc(db: Db, userId: string, kcId: string) {
  return requireOwnedKc(db, userId, kcId);
}

export async function updateKc(db: Db, userId: string, kcId: string, input: UpdateKcInput) {
  await requireOwnedKc(db, userId, kcId);

  const patch: Partial<typeof kcs.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.kc_type !== undefined) patch.kcType = input.kc_type;
  if (input.description !== undefined) patch.description = input.description;
  if (input.practice_notes !== undefined) patch.practiceNotes = input.practice_notes;

  await db.update(kcs).set(patch).where(eq(kcs.id, kcId));
  return requireOwnedKc(db, userId, kcId);
}
