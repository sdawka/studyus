import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, events, kcs, misconceptions, tutorConversations, userCorrections, userMisconceptions, users } from '../src/db/schema';
import { createCorrection, listCorrections, updateCorrection } from '../src/lib/services/corrections';
import { getLearnerAgentForUser } from '../src/lib/runtime/learnerAgent';
import { verifyRuntimeConversationProvenance } from '../src/lib/runtime/tutorRuntime';
import { createCorrectionSchema } from '../src/lib/schemas/corrections';
import { ForbiddenError, NotFoundError } from '../src/lib/services/util';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let branchId: string;
let kcId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  branchId = crypto.randomUUID();
  kcId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'CHEE 310', slug: `chee-310-${courseId}`, title: 'Fluid Mechanics' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Bernoulli equation', kcType: 'concept', slug: 'bernoulli-equation' });
});

describe('createCorrection', () => {
  it('creates a KC-scoped correction, stamping accepted_at/status server-side, joined with kc_name/course_slug', async () => {
    const before = Date.now();
    const created = await createCorrection(db, userId, {
      kc_id: kcId,
      correction: "Bernoulli's equation only applies along a streamline in steady flow.",
      prior_belief: 'It relates any two points in a flow.',
    });

    expect(created.status).toBe('active');
    expect(created.acceptedAt).toBeGreaterThanOrEqual(before);
    expect(created.kcName).toBe('Bernoulli equation');
    expect(created.courseSlug).toBe(`chee-310-${courseId}`);
    expect(created.kcId).toBe(kcId);
  });

  it('creates a freeform correction (no kc_id) with null kc_name/course_slug', async () => {
    const created = await createCorrection(db, userId, { correction: 'Always check units before comparing values.' });
    expect(created.kcId).toBeNull();
    expect(created.kcName).toBeNull();
    expect(created.courseSlug).toBeNull();
  });

  it('resolves misconception_id (seed content, no owner check) and links it', async () => {
    const misconceptionId = crypto.randomUUID();
    await db.insert(misconceptions).values({
      id: misconceptionId,
      kcId,
      slug: 'bernoulli-between-any-two-points',
      name: 'Bernoulli relates any two points',
      description: 'Assumed to hold between any two arbitrary points.',
      rootCause: 'Missing the streamline precondition.',
      diagnosticProbe: 'Are the two points on the same streamline?',
      correction: 'Bernoulli only relates points on the same streamline in steady flow.',
    });

    const created = await createCorrection(db, userId, {
      kc_id: kcId,
      misconception_id: misconceptionId,
      correction: 'Bernoulli only relates points on the same streamline in steady flow.',
    });
    expect(created.misconceptionId).toBe(misconceptionId);
    const lifecycle = await db
      .select()
      .from(userMisconceptions)
      .where(eq(userMisconceptions.userId, userId));
    expect(lifecycle).toHaveLength(1);
    expect(lifecycle[0].misconceptionId).toBe(misconceptionId);
    expect(lifecycle[0].status).toBe('correcting');
    expect(lifecycle[0].confirmedAt).not.toBeNull();
    expect(lifecycle[0].correctingAt).not.toBeNull();
    expect(lifecycle[0].evidenceEventIds).toHaveLength(1);

    const accepted = await db.select().from(events).where(eq(events.id, lifecycle[0].evidenceEventIds[0])).limit(1);
    expect(accepted[0].type).toBe('correction_accepted');
    expect(accepted[0].isAssessment).toBe(false);
    expect(accepted[0].isInstructional).toBe(false);
  });

  it('records source_conversation_id only when the runtime supplies matching verified provenance', async () => {
    const learner = await getLearnerAgentForUser(env, userId);
    const conversation = await learner.createConversation({ kcId, mode: 'absorb' });
    const provenance = await verifyRuntimeConversationProvenance(db, env, userId, conversation.id);

    const created = await createCorrection(db, userId, {
      kc_id: kcId,
      source_conversation_id: conversation.id,
      correction: 'Corrected via tutor.',
    }, provenance);
    expect(created.sourceConversationId).toBe(conversation.id);

    // The correction ledger write is followed by its canonical activity
    // event, and the event remains entirely scoped to this learner/KC.
    const accepted = await db.select().from(events).where(eq(events.userId, userId));
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({
      type: 'correction_accepted',
      source: 'tutor',
      kcId,
      isInstructional: false,
      isAssessment: false,
    });
    expect(accepted[0].ts).toBeGreaterThanOrEqual(created.acceptedAt);
    expect(accepted[0].payload).toMatchObject({ correction_id: created.id });
  });

  it('does not verify a conversation ID from another learner Durable Object', async () => {
    const otherUserId = crypto.randomUUID();
    const otherLearner = await getLearnerAgentForUser(env, otherUserId);
    const otherConversation = await otherLearner.createConversation({ kcId, mode: 'absorb' });

    const correctionsBefore = await db.select().from(userCorrections).where(eq(userCorrections.userId, userId));
    const eventsBefore = await db.select().from(events).where(eq(events.userId, userId));
    await expect(
      verifyRuntimeConversationProvenance(db, env, userId, otherConversation.id),
    ).rejects.toThrow(NotFoundError);
    expect(await db.select().from(userCorrections).where(eq(userCorrections.userId, userId))).toEqual(correctionsBefore);
    expect(await db.select().from(events).where(eq(events.userId, userId))).toEqual(eventsBefore);
  });

  it('verifies an owned legacy D1 conversation after its one-way import into the learner object', async () => {
    const conversationId = crypto.randomUUID();
    await db.insert(tutorConversations).values({ id: conversationId, userId, kcId, mode: 'absorb' });

    // The import marker makes this safe to call again when an ingress retries.
    await expect(verifyRuntimeConversationProvenance(db, env, userId, conversationId)).resolves.toEqual({ sourceConversationId: conversationId });
    await expect(verifyRuntimeConversationProvenance(db, env, userId, conversationId)).resolves.toEqual({ sourceConversationId: conversationId });
  });

  it('rejects a random/nonexistent provenance ID without writing a correction or activity event', async () => {
    const missingId = crypto.randomUUID();
    await expect(verifyRuntimeConversationProvenance(db, env, userId, missingId)).rejects.toThrow(NotFoundError);
    expect(await db.select().from(userCorrections).where(eq(userCorrections.userId, userId))).toEqual([]);
    expect(await db.select().from(events).where(eq(events.userId, userId))).toEqual([]);
  });

  it('404s on a kc_id owned by another user', async () => {
    const otherUserId = crypto.randomUUID();
    const otherCourseId = crypto.randomUUID();
    const otherBranchId = crypto.randomUUID();
    const otherKcId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'X 1', slug: `other-${otherCourseId}`, title: 'Other' });
    await db.insert(branches).values({ id: otherBranchId, courseId: otherCourseId, name: 'B' });
    await db.insert(kcs).values({ id: otherKcId, branchId: otherBranchId, courseId: otherCourseId, name: 'Other', kcType: 'concept' });

    await expect(createCorrection(db, userId, { kc_id: otherKcId, correction: 'x' })).rejects.toThrow(NotFoundError);
  });

  it('404s on a nonexistent misconception_id', async () => {
    await expect(
      createCorrection(db, userId, { misconception_id: crypto.randomUUID(), correction: 'x' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects unverified or mismatched opaque conversation provenance', async () => {
    const conversationId = crypto.randomUUID();
    await expect(
      createCorrection(db, userId, { source_conversation_id: conversationId, correction: 'x' }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      createCorrection(
        db,
        userId,
        { source_conversation_id: conversationId, correction: 'x' },
        { sourceConversationId: crypto.randomUUID() },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('permits omitted provenance for a manual correction and rejects an invalid source ID before any write', async () => {
    const manual = await createCorrection(db, userId, { correction: 'Check units first.' });
    expect(manual.sourceConversationId).toBeNull();
    expect(createCorrectionSchema.safeParse({ correction: 'x', source_conversation_id: 'not-a-uuid' }).success).toBe(false);
    const correctionsBefore = await db.select().from(userCorrections).where(eq(userCorrections.userId, userId));
    const eventsBefore = await db.select().from(events).where(eq(events.userId, userId));
    expect(correctionsBefore).toHaveLength(1);
    expect(eventsBefore).toHaveLength(1);
  });
});

describe('listCorrections', () => {
  it('lists newest (accepted_at desc) first and filters by status', async () => {
    const first = await createCorrection(db, userId, { correction: 'First' });
    await new Promise((r) => setTimeout(r, 5));
    const second = await createCorrection(db, userId, { correction: 'Second' });

    const all = await listCorrections(db, userId);
    expect(all.map((c) => c.id)).toEqual([second.id, first.id]);

    await updateCorrection(db, userId, first.id, { status: 'internalized' });

    const active = await listCorrections(db, userId, { status: 'active' });
    expect(active.map((c) => c.id)).toEqual([second.id]);

    const internalized = await listCorrections(db, userId, { status: 'internalized' });
    expect(internalized.map((c) => c.id)).toEqual([first.id]);
  });

  it('scopes strictly to the caller — never lists another user\'s corrections', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await createCorrection(db, otherUserId, { correction: 'Not mine' });
    await createCorrection(db, userId, { correction: 'Mine' });

    const rows = await listCorrections(db, userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].correction).toBe('Mine');
  });
});

describe('updateCorrection', () => {
  it('transitions status active -> internalized', async () => {
    const created = await createCorrection(db, userId, { correction: 'x' });
    const updated = await updateCorrection(db, userId, created.id, { status: 'internalized' });
    expect(updated.status).toBe('internalized');
  });

  it('internalizing a known correction advances its misconception lifecycle', async () => {
    const misconceptionId = crypto.randomUUID();
    await db.insert(misconceptions).values({
      id: misconceptionId,
      kcId,
      slug: 'known-misconception',
      name: 'Known misconception',
      description: 'Wrong model.',
      rootCause: 'Overgeneralization.',
      diagnosticProbe: 'Does this always hold?',
      correction: 'It only holds under stated conditions.',
    });
    const created = await createCorrection(db, userId, { kc_id: kcId, misconception_id: misconceptionId, correction: 'Correct model.' });
    await updateCorrection(db, userId, created.id, { status: 'internalized' });

    const rows = await db
      .select()
      .from(userMisconceptions)
      .where(eq(userMisconceptions.misconceptionId, misconceptionId));
    expect(rows[0].status).toBe('internalized');
    expect(rows[0].internalizedAt).not.toBeNull();
  });

  it('404s on a correction owned by another user', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    const created = await createCorrection(db, otherUserId, { correction: 'x' });

    await expect(updateCorrection(db, userId, created.id, { status: 'internalized' })).rejects.toThrow(NotFoundError);
  });
});
