import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, events, kcs, tutorMessages, users } from '../src/db/schema';
import {
  appendMessageAndStream,
  ConversationCapReachedError,
  createConversation,
  endConversation,
  getConversation,
  MAX_MESSAGES_PER_CONVERSATION,
} from '../src/lib/services/tutor/conversations';

const db = getDb(env.DB);
const AI_ENV = { AI_FEATURES_ENABLED: 'true', OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'test-model' } as const;

let userId: string;
let courseId: string;

async function makeKc(kcType: 'fact' | 'association' | 'concept' | 'rule' | 'principle') {
  const branchId = crypto.randomUUID();
  const kcId = crypto.randomUUID();
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name: `KC-${kcType}`, kcType });
  return kcId;
}

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course', overview: 'A course.' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createConversation', () => {
  it.each([
    ['fact', 'recall'],
    ['association', 'recall'],
    ['concept', 'classify'],
    ['rule', 'worked_example'],
    ['principle', 'interactive_model'],
  ] as const)('derives mode %s -> %s from kc_type when no mode is given', async (kcType, expectedMode) => {
    const kcId = await makeKc(kcType);
    const convo = await createConversation(db, userId, { kc_id: kcId });
    expect(convo.mode).toBe(expectedMode);
  });

  it('honors an explicit mode override (e.g. principle -> self_explain)', async () => {
    const kcId = await makeKc('principle');
    const convo = await createConversation(db, userId, { kc_id: kcId, mode: 'self_explain' });
    expect(convo.mode).toBe('self_explain');
  });
});

function mockStreamingFetch(replyText: string) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: replyText } }] })}\n\n`));
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status: 200 })),
  );
}

async function drainToText(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

describe('appendMessageAndStream', () => {
  it('persists the user message immediately and the assistant reply once the stream completes', async () => {
    const kcId = await makeKc('concept');
    const convo = await createConversation(db, userId, { kc_id: kcId });
    mockStreamingFetch('Here is a classification question. What category is this?');

    const stream = await appendMessageAndStream(db, userId, convo.id, 'Hi tutor', AI_ENV);
    await drainToText(stream);

    const messages = await db.select().from(tutorMessages).where(eq(tutorMessages.conversationId, convo.id));
    expect(messages).toHaveLength(2);
    expect(messages.find((m) => m.role === 'user')?.content).toBe('Hi tutor');
    expect(messages.find((m) => m.role === 'assistant')?.content).toContain('classification question');
  });

  it('throws ConversationCapReachedError and auto-ends the conversation once the message cap is hit', async () => {
    const kcId = await makeKc('fact');
    const convo = await createConversation(db, userId, { kc_id: kcId });

    // Fill the conversation up to the cap directly (cheaper than streaming
    // MAX_MESSAGES_PER_CONVERSATION real exchanges). Inserted one row at a
    // time — the local D1 emulator caps bound parameters per statement well
    // below what a single bulk `.values([...])` of 30 rows needs.
    for (let i = 0; i < MAX_MESSAGES_PER_CONVERSATION; i++) {
      await db.insert(tutorMessages).values({
        id: crypto.randomUUID(),
        conversationId: convo.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`,
      });
    }

    await expect(
      appendMessageAndStream(db, userId, convo.id, 'one more please', AI_ENV),
    ).rejects.toThrow(ConversationCapReachedError);

    const kcEvents = await db.select().from(events).where(eq(events.kcId, kcId));
    const tutorSessionEvents = kcEvents.filter((e) => e.type === 'tutor_session');
    expect(tutorSessionEvents).toHaveLength(1);
  });
});

describe('endConversation', () => {
  it('appends a dual-role tutor_session event for the conversation KC', async () => {
    const kcId = await makeKc('rule');
    const convo = await createConversation(db, userId, { kc_id: kcId });

    const { event, mastery_deltas } = await endConversation(db, userId, convo.id, { final_rating: 4 });

    expect(event.type).toBe('tutor_session');
    expect(event.isInstructional).toBe(true);
    expect(event.isAssessment).toBe(true);
    expect((event.payload as Record<string, unknown>).final_rating).toBe(4);
    expect(mastery_deltas).toHaveLength(1);
  });
});

describe('getConversation', () => {
  it('returns the conversation with its messages in chronological order', async () => {
    const kcId = await makeKc('fact');
    const convo = await createConversation(db, userId, { kc_id: kcId });
    await db.insert(tutorMessages).values([
      { id: crypto.randomUUID(), conversationId: convo.id, role: 'user', content: 'first' },
      { id: crypto.randomUUID(), conversationId: convo.id, role: 'assistant', content: 'second' },
    ]);

    const result = await getConversation(db, userId, convo.id);
    expect(result.messages.map((m) => m.content)).toEqual(['first', 'second']);
  });
});
