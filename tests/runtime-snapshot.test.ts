import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, kcs, users } from '../src/db/schema';
import { getLearnerAgentForUser } from '../src/lib/runtime/learnerAgent';
import { GET as getRuntimeSnapshot } from '../src/pages/api/v1/runtime/snapshot';
import { GET as getConversation } from '../src/pages/api/v1/tutor/conversations/[id]/index';

const db = getDb(env.DB);

async function makeKc(userId: string, label: string) {
  const courseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  const kcId = crypto.randomUUID();
  await db.batch([
    db.insert(users).values({ id: userId, email: `${userId}@runtime.test`, passwordHash: 'x' }),
    db.insert(courses).values({ id: courseId, userId, code: label, slug: `${label.toLowerCase()}-${courseId}`, title: label }),
    db.insert(branches).values({ id: branchId, courseId, name: 'Main' }),
    db.insert(kcs).values({ id: kcId, branchId, courseId, name: `${label} KC`, kcType: 'concept' }),
  ]);
  return kcId;
}

describe('learner runtime HTTP projection', () => {
  it('returns every caller-owned active conversation and preserves authoritative status', async () => {
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const ownedKcId = await makeKc(userId, 'OWN');
    const foreignKcId = await makeKc(otherUserId, 'OTHER');
    const learner = await getLearnerAgentForUser(env, userId);
    const active = await learner.createConversation({ kcId: ownedKcId, mode: 'recall' });
    const ended = await learner.createConversation({ kcId: ownedKcId, mode: 'absorb' });
    await learner.endConversation(ended.id);
    // Direct DO access can bypass the normal service ownership guard. The
    // browser projection must still refuse to expose that malformed record.
    await learner.createConversation({ kcId: foreignKcId, mode: 'recall' });
    await learner.setSessionState({ key: 'orchestrator', value: { stage: 'diagnose' } });

    const snapshotResponse = await getRuntimeSnapshot({ locals: { user: { id: userId } } } as never);
    expect(snapshotResponse.status).toBe(200);
    const snapshotBody = (await snapshotResponse.json()) as {
      data: {
        active_conversations: Array<{ id: string; kc_id: string; status: string; active_turn_id: string | null }>;
        sessions: Array<{ key: string; value: unknown; version: number }>;
        next_alarm_at: string | null;
        learner_id?: string;
      };
    };
    expect(snapshotBody.data.active_conversations).toEqual([
      expect.objectContaining({ id: active.id, kc_id: ownedKcId, status: 'active', active_turn_id: null }),
    ]);
    expect(snapshotBody.data.sessions).toEqual([
      expect.objectContaining({ key: 'orchestrator', value: { stage: 'diagnose' }, version: 1 }),
    ]);
    expect(snapshotBody.data).not.toHaveProperty('learner_id');

    const conversationResponse = await getConversation({
      params: { id: ended.id },
      locals: { user: { id: userId } },
    } as never);
    const conversationBody = (await conversationResponse.json()) as {
      data: { id: string; status: string; active_turn_id: string | null; ended_at: string | null; messages: unknown[] };
    };
    expect(conversationBody.data).toMatchObject({
      id: ended.id,
      status: 'ended',
      active_turn_id: null,
      messages: [],
    });
    expect(conversationBody.data.ended_at).not.toBeNull();
  });
});
