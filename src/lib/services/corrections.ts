// v1.7 — the user's accepted-correction ledger (docs/api.md's "Corrections"
// section). Entries are created either when a tutor's fenced
// correction_proposal (absorb flow) is accepted by the client, or manually
// via POST /corrections.
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, kcs, misconceptions, tutorConversations, userCorrections } from '../../db/schema';
import type { CreateCorrectionInput, ListCorrectionsQuery, UpdateCorrectionInput } from '../schemas/corrections';
import { NotFoundError, requireOwnedKc } from './util';

type CorrectionRow = typeof userCorrections.$inferSelect;
export type ShapedCorrection = CorrectionRow & { kcName: string | null; courseSlug: string | null };

// Joins in kc_name/course_slug (both null when kc_id is null — a freeform
// correction with no specific KC) — the shape docs/api.md's Correction type
// requires. Scoped by an optional extra predicate (status filter, or a
// single id) on top of the mandatory userId ownership condition.
async function selectShaped(db: Db, userId: string, extra?: SQL): Promise<ShapedCorrection[]> {
  const conditions = [eq(userCorrections.userId, userId)];
  if (extra) conditions.push(extra);

  const rows = await db
    .select({ row: userCorrections, kcName: kcs.name, courseSlug: courses.slug })
    .from(userCorrections)
    .leftJoin(kcs, eq(userCorrections.kcId, kcs.id))
    .leftJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(...conditions))
    .orderBy(desc(userCorrections.acceptedAt));

  return rows.map((r) => ({ ...r.row, kcName: r.kcName, courseSlug: r.courseSlug }));
}

export async function listCorrections(db: Db, userId: string, filter: ListCorrectionsQuery = {}): Promise<ShapedCorrection[]> {
  return selectShaped(db, userId, filter.status ? eq(userCorrections.status, filter.status) : undefined);
}

async function requireShapedCorrection(db: Db, userId: string, id: string): Promise<ShapedCorrection> {
  const rows = await selectShaped(db, userId, eq(userCorrections.id, id));
  const row = rows[0];
  if (!row) throw new NotFoundError('Correction');
  return row;
}

export async function createCorrection(db: Db, userId: string, input: CreateCorrectionInput): Promise<ShapedCorrection> {
  if (input.kc_id) await requireOwnedKc(db, userId, input.kc_id);

  if (input.misconception_id) {
    // Misconceptions are seed content with no user-scoped owner — existence
    // is all that's checked, not ownership.
    const rows = await db.select({ id: misconceptions.id }).from(misconceptions).where(eq(misconceptions.id, input.misconception_id)).limit(1);
    if (!rows[0]) throw new NotFoundError('Misconception');
  }

  if (input.source_conversation_id) {
    const rows = await db
      .select({ id: tutorConversations.id })
      .from(tutorConversations)
      .where(and(eq(tutorConversations.id, input.source_conversation_id), eq(tutorConversations.userId, userId)))
      .limit(1);
    if (!rows[0]) throw new NotFoundError('Tutor conversation');
  }

  const id = crypto.randomUUID();
  await db.insert(userCorrections).values({
    id,
    userId,
    kcId: input.kc_id ?? null,
    misconceptionId: input.misconception_id ?? null,
    priorBelief: input.prior_belief ?? null,
    correction: input.correction,
    status: 'active',
    acceptedAt: Date.now(),
    sourceConversationId: input.source_conversation_id ?? null,
  });

  return requireShapedCorrection(db, userId, id);
}

export async function updateCorrection(db: Db, userId: string, id: string, patch: UpdateCorrectionInput): Promise<ShapedCorrection> {
  await requireShapedCorrection(db, userId, id); // 404s on a cross-user id before attempting the write

  if (patch.status !== undefined) {
    await db.update(userCorrections).set({ status: patch.status }).where(eq(userCorrections.id, id));
  }

  return requireShapedCorrection(db, userId, id);
}
