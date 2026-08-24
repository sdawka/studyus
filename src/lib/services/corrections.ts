// v1.7 — the user's accepted-correction ledger (docs/api.md's "Corrections"
// section). Entries are created either when a tutor's fenced
// correction_proposal (absorb flow) is accepted by the client, or manually
// via POST /corrections.
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, kcs, userCorrections } from '../../db/schema';
import type { CreateCorrectionInput, ListCorrectionsQuery, UpdateCorrectionInput } from '../schemas/corrections';
import { createEvent } from './events';
import { advanceUserMisconception, requireOwnedMisconception } from './misconceptionLifecycle';
import { ForbiddenError, NotFoundError, requireOwnedKc } from './util';

type CorrectionRow = typeof userCorrections.$inferSelect;
export type ShapedCorrection = CorrectionRow & { kcName: string | null; courseSlug: string | null };

/**
 * A source conversation is stored as an opaque ID because tutor transcripts
 * are owned by the learner Durable Object, not D1.  The HTTP/runtime ingress
 * must therefore verify the ID in that learner's object before handing this
 * capability to the ledger service. Keeping the proof separate from client
 * input prevents a caller from attaching another learner's conversation ID.
 */
export type VerifiedCorrectionProvenance = {
  sourceConversationId: string;
};

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

export async function createCorrection(
  db: Db,
  userId: string,
  input: CreateCorrectionInput,
  provenance?: VerifiedCorrectionProvenance,
): Promise<ShapedCorrection> {
  if (input.kc_id) await requireOwnedKc(db, userId, input.kc_id);

  if (input.misconception_id) {
    // The misconception is knowledge-plane content, but its KC must still be
    // reachable through this learner's course graph before it can affect the
    // learner plane.
    await requireOwnedMisconception(db, userId, input.misconception_id);
  }

  // DO-owned conversation ids have no D1 foreign key. A client-supplied ID
  // is accepted only when the authenticated runtime has verified that exact
  // ID in this learner's Durable Object.
  if (input.source_conversation_id && provenance?.sourceConversationId !== input.source_conversation_id) {
    throw new ForbiddenError('Conversation provenance was not verified for this learner');
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

  // Accepting a correction is an activity-stream fact, not learning evidence:
  // role flags are false so it cannot reset KC freshness or alter mastery.
  // Link known misconceptions to the same durable event that records the
  // acceptance, then advance them through confirmation into correction.
  const { event } = await createEvent(
    db,
    userId,
    {
      type: 'correction_accepted',
      kc_id: input.kc_id,
      payload: { correction_id: id, misconception_id: input.misconception_id ?? null },
    },
    'tutor',
  );
  if (input.misconception_id) {
    await advanceUserMisconception(db, userId, {
      misconception_id: input.misconception_id,
      status: 'correcting',
      evidence_event_id: event.id,
    });
  }

  return requireShapedCorrection(db, userId, id);
}

export async function updateCorrection(db: Db, userId: string, id: string, patch: UpdateCorrectionInput): Promise<ShapedCorrection> {
  const current = await requireShapedCorrection(db, userId, id); // 404s on a cross-user id before attempting the write

  if (patch.status !== undefined) {
    await db.update(userCorrections).set({ status: patch.status }).where(eq(userCorrections.id, id));
    if (patch.status === 'internalized' && current.misconceptionId) {
      await advanceUserMisconception(db, userId, {
        misconception_id: current.misconceptionId,
        status: 'internalized',
      });
    }
  }

  return requireShapedCorrection(db, userId, id);
}
