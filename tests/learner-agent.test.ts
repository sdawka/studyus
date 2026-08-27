import { env, reset } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { getLearnerAgentForUser } from '../src/lib/runtime/learnerAgent';

afterEach(async () => {
  await reset();
});

describe('LearnerAgent', () => {
  it('isolates each deterministic learner runtime and persists the conversation tool/session state', async () => {
    const learnerOne = await getLearnerAgentForUser(env, crypto.randomUUID());
    const learnerTwo = await getLearnerAgentForUser(env, crypto.randomUUID());

    const conversation = await learnerOne.createConversation({
      kcId: 'kc-1',
      mode: 'socratic',
      details: { source: 'test' },
    });
    await learnerOne.appendMessage({ conversationId: conversation.id, content: 'I think I understand it.' });
    const state = await learnerOne.setSessionState({ key: 'orchestrator', value: { step: 'diagnose' } });
    const toolCall = await learnerOne.createToolCall({ conversationId: conversation.id, name: 'diagnostic_probe', input: { kcId: 'kc-1' } });
    const resolved = await learnerOne.resolveToolCall({ id: toolCall.id, status: 'succeeded', output: { correct: false } });

    expect((await learnerOne.getConversation(conversation.id)).messages).toMatchObject([
      { role: 'user', content: 'I think I understand it.' },
    ]);
    expect(await learnerOne.getSessionState('orchestrator')).toEqual({
      key: 'orchestrator',
      value: { step: 'diagnose' },
      version: state.version,
      updatedAt: state.updatedAt,
    });
    expect(resolved).toMatchObject({ status: 'succeeded', output: { correct: false } });
    const secondConversation = await learnerOne.createConversation({ kcId: 'kc-2', mode: 'recall' });
    expect(new Set((await learnerOne.getSnapshot()).activeConversations.map((item) => item.id))).toEqual(
      new Set([secondConversation.id, conversation.id]),
    );
    expect(await learnerTwo.listConversations()).toEqual([]);
  });

  it('schedules per-learner alarms and imports a legacy transcript at most once', async () => {
    const learner = await getLearnerAgentForUser(env, crypto.randomUUID());
    const conversationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    await expect(
      learner.importLegacyConversations({
        source: 'd1-tutor-conversations-v1',
        conversations: [
          {
            id: conversationId,
            kcId: 'kc-legacy',
            mode: 'recall',
            createdAt: 100,
            messages: [{ id: messageId, role: 'assistant', content: 'Welcome back.', createdAt: 101 }],
          },
        ],
      }),
    ).resolves.toEqual({ imported: true, conversationCount: 1 });
    await expect(
      learner.importLegacyConversations({ source: 'd1-tutor-conversations-v1', conversations: [] }),
    ).resolves.toEqual({ imported: false, conversationCount: 0 });
    expect((await learner.getConversation(conversationId)).messages).toMatchObject([{ id: messageId, role: 'assistant' }]);

    const scheduledAt = Date.now() + 60_000;
    await learner.scheduleAlarm({ kind: 'review', payload: { kcId: 'kc-legacy' }, scheduledAt });
    expect(await learner.getSnapshot()).toMatchObject({
      activeConversations: [{ id: conversationId, status: 'active' }],
      nextAlarmAt: scheduledAt,
    });
  });
});
