import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import type { UpdateUserInput } from '../schemas/user';

export async function updateUser(db: Db, userId: string, input: UpdateUserInput) {
  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.current_term !== undefined) patch.currentTerm = input.current_term;
  await db.update(users).set(patch).where(eq(users.id, userId));

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0];
}
