import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { resources } from '../../db/schema';
import type { CreateResourceInput, ListResourcesQuery } from '../schemas/resources';
import { NotFoundError, requireOwnedCourse, requireOwnedKc } from './util';

export async function listResources(db: Db, userId: string, query: ListResourcesQuery) {
  const conditions = [eq(resources.userId, userId)];
  if (query.course) conditions.push(eq(resources.courseId, query.course));
  if (query.kind) conditions.push(eq(resources.kind, query.kind));
  return db.select().from(resources).where(and(...conditions));
}

export async function createResource(db: Db, userId: string, input: CreateResourceInput) {
  if (input.course_id) await requireOwnedCourse(db, userId, input.course_id);
  if (input.kc_id) await requireOwnedKc(db, userId, input.kc_id);

  const id = crypto.randomUUID();
  await db.insert(resources).values({
    id,
    userId,
    url: input.url,
    label: input.label,
    kind: 'user_shared',
    courseId: input.course_id ?? null,
    kcId: input.kc_id ?? null,
    addedBy: userId,
  });

  const rows = await db.select().from(resources).where(eq(resources.id, id)).limit(1);
  return rows[0];
}

export async function deleteResource(db: Db, userId: string, resourceId: string) {
  const rows = await db.select().from(resources).where(and(eq(resources.id, resourceId), eq(resources.userId, userId))).limit(1);
  if (!rows[0]) throw new NotFoundError('Resource');
  await db.delete(resources).where(eq(resources.id, resourceId));
}
