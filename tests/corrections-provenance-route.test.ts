import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, events, kcs, tutorConversations, userCorrections, users } from '../src/db/schema';
import { getLearnerAgentForUser } from '../src/lib/runtime/learnerAgent';
import * as correctionsRoutes from '../src/pages/api/v1/corrections/index';

const db = getDb(env.DB);

type Fixture = { userId: string; courseId: string; kcId: string };

async function makeFixture(): Promise<Fixture> {
  const userId = crypto.randomUUID();
  const courseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  const kcId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test course' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Test branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'Test KC', kcType: 'concept' });
  return { userId, courseId, kcId };
}

function postCorrection(userId: string, body: Record<string, unknown>) {
  const request = new Request('http://local.test/api/v1/corrections', { method: 'POST', body: JSON.stringify(body) });
  return correctionsRoutes.POST({
    request,
    url: new URL(request.url),
    locals: { user: { id: userId } },
    params: {},
    cookies: {} as never,
  } as never);
}

async function callerRows(userId: string) {
  const [corrections, activity] = await Promise.all([
    db.select().from(userCorrections).where(eq(userCorrections.userId, userId)),
    db.select().from(events).where(eq(events.userId, userId)),
  ]);
  return { corrections, activity };
}

describe('POST /corrections Durable Object provenance', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await makeFixture();
  });

  it('accepts a caller-owned DO conversation and appends its canonical activity event after the ledger write', async () => {
    const learner = await getLearnerAgentForUser(env, fixture.userId);
    const conversation = await learner.createConversation({ kcId: fixture.kcId, mode: 'absorb' });

    const response = await postCorrection(fixture.userId, {
      kc_id: fixture.kcId,
      source_conversation_id: conversation.id,
      correction: 'A streamline is required.',
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { id: string; accepted_at: string; source_conversation_id: string } };
    expect(body.data.source_conversation_id).toBe(conversation.id);

    const { corrections, activity } = await callerRows(fixture.userId);
    expect(corrections).toHaveLength(1);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      type: 'correction_accepted',
      userId: fixture.userId,
      kcId: fixture.kcId,
      source: 'tutor',
      isInstructional: false,
      isAssessment: false,
      payload: { correction_id: body.data.id },
    });
    expect(activity[0]!.ts).toBeGreaterThanOrEqual(corrections[0]!.acceptedAt);
  });

  it('returns 404 for a random ID without a correction or activity event', async () => {
    const response = await postCorrection(fixture.userId, {
      source_conversation_id: crypto.randomUUID(),
      correction: 'No provenance.',
    });

    expect(response.status).toBe(404);
    expect(await callerRows(fixture.userId)).toEqual({ corrections: [], activity: [] });
  });

  it('returns 404 for another tenant\'s new-DO or legacy-D1 conversation IDs without writes', async () => {
    const other = await makeFixture();
    const otherLearner = await getLearnerAgentForUser(env, other.userId);
    const otherConversation = await otherLearner.createConversation({ kcId: other.kcId, mode: 'absorb' });
    const otherLegacyId = crypto.randomUUID();
    await db.insert(tutorConversations).values({ id: otherLegacyId, userId: other.userId, kcId: other.kcId, mode: 'absorb' });

    for (const sourceConversationId of [otherConversation.id, otherLegacyId]) {
      const response = await postCorrection(fixture.userId, {
        source_conversation_id: sourceConversationId,
        correction: 'Not my conversation.',
      });
      expect(response.status).toBe(404);
      expect(await callerRows(fixture.userId)).toEqual({ corrections: [], activity: [] });
    }
  });

  it('returns 404 and records nothing when the DO conversation KC is no longer owned by the caller', async () => {
    const learner = await getLearnerAgentForUser(env, fixture.userId);
    const conversation = await learner.createConversation({ kcId: fixture.kcId, mode: 'absorb' });
    const newOwner = await makeFixture();
    await db.update(courses).set({ userId: newOwner.userId }).where(eq(courses.id, fixture.courseId));

    const response = await postCorrection(fixture.userId, {
      source_conversation_id: conversation.id,
      correction: 'The ownership changed.',
    });

    expect(response.status).toBe(404);
    expect(await callerRows(fixture.userId)).toEqual({ corrections: [], activity: [] });
  });
});
