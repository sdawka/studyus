// Absorb-mode conversation tests: details persistence, absorb-only context
// assembly (prereq graph / misconceptions / scaffolds), the absorb-specific
// message cap, and tutor_session event attribution. knowledgeMap.ts is owned
// by a parallel track — mocked here for isolation (per the frozen
// getKcGraph/listKcMisconceptions/listKcScaffolds signatures) rather than
// exercised for real, same as tutor-conversations.test.ts mocks `fetch`
// rather than hitting OpenRouter.
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/services/knowledgeMap', () => ({
  getKcGraph: vi.fn(),
  listKcMisconceptions: vi.fn(),
  listKcScaffolds: vi.fn(),
}));

import { getDb } from '../src/db/client';
import { branches, courses, events, kcs, tutorMessages, users } from '../src/db/schema';
import { getKcGraph, listKcMisconceptions, listKcScaffolds } from '../src/lib/services/knowledgeMap';
import {
  appendMessageAndStream,
  ConversationCapReachedError,
  createConversation,
  endConversation,
  getConversation,
  MAX_MESSAGES_PER_CONVERSATION_ABSORB,
} from '../src/lib/services/tutor/conversations';

const db = getDb(env.DB);
const AI_ENV = { AI_FEATURES_ENABLED: 'true', OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'test-model' } as const;

const mockGetKcGraph = vi.mocked(getKcGraph);
const mockListKcMisconceptions = vi.mocked(listKcMisconceptions);
const mockListKcScaffolds = vi.mocked(listKcScaffolds);

let userId: string;
let courseId: string;

async function makeKc(kcType: 'fact' | 'association' | 'concept' | 'rule' | 'principle', name = `KC-${kcType}`) {
  const branchId = crypto.randomUUID();
  const kcId = crypto.randomUUID();
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
  await db.insert(kcs).values({ id: kcId, branchId, courseId, name, kcType });
  return kcId;
}

function mockStreamingFetch(replyText: string) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: replyText } }] })}\n\n`));
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  let capturedBody: unknown;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      return new Response(body, { status: 200 });
    }),
  );
  return () => capturedBody as { messages: Array<{ role: string; content: string }> };
}

async function drainToText(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course', overview: 'A course.' });

  mockGetKcGraph.mockReset();
  mockListKcMisconceptions.mockReset();
  mockListKcScaffolds.mockReset();
  mockGetKcGraph.mockResolvedValue({ kc: { id: 'x', name: 'x', kc_type: 'principle', mastery: 0, status: 'not-started' }, prereqs: [], warnings: [] });
  mockListKcMisconceptions.mockResolvedValue([]);
  mockListKcScaffolds.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createConversation — details persistence', () => {
  it('persists an explicit absorb mode + details.focus_order verbatim and echoes it back', async () => {
    const kcId = await makeKc('principle');
    const focusOrder = [crypto.randomUUID(), crypto.randomUUID()];
    const convo = await createConversation(db, userId, {
      kc_id: kcId,
      mode: 'absorb',
      details: { flow: 'absorb', focus_order: focusOrder },
    });

    expect(convo.mode).toBe('absorb');
    expect(convo.details).toEqual({ flow: 'absorb', focus_order: focusOrder });

    const fetched = await getConversation(db, userId, convo.id);
    expect(fetched.details).toEqual({ flow: 'absorb', focus_order: focusOrder });
  });

  it('never derives absorb from kc_type — a principle KC created with no mode override stays interactive_model', async () => {
    const kcId = await makeKc('principle');
    const convo = await createConversation(db, userId, { kc_id: kcId });
    expect(convo.mode).toBe('interactive_model');
  });

  it('defaults details to {} when omitted', async () => {
    const kcId = await makeKc('concept');
    const convo = await createConversation(db, userId, { kc_id: kcId });
    expect(convo.details).toEqual({});
  });
});

describe('appendMessageAndStream — absorb context assembly', () => {
  it('gathers the prereq graph, misconceptions, and scaffolds for an absorb conversation', async () => {
    const kcId = await makeKc('principle', 'Bernoulli Equation');
    const prereqKcId = crypto.randomUUID();

    mockGetKcGraph.mockResolvedValue({
      kc: { id: kcId, name: 'Bernoulli Equation', kc_type: 'principle', mastery: 20, status: 'learning' },
      prereqs: [
        {
          kc_id: prereqKcId,
          slug: 'fluid-velocity',
          name: 'Fluid Velocity',
          kc_type: 'concept',
          mastery: 25,
          status: 'learning',
          ready: false,
          depth: 1,
          prereq_kc_ids: [],
        },
      ],
      warnings: [],
    });
    mockListKcMisconceptions.mockResolvedValue([
      {
        id: 'm1',
        kcId,
        slug: 'pressure-vs-force',
        name: 'Pressure/force conflation',
        description: 'Conflates pressure and force.',
        rootCause: 'Everyday language.',
        diagnosticProbe: 'Does pressure change if area doubles at constant force?',
        correction: 'Pressure is force per area.',
        source: 'seed',
        createdAt: Date.now(),
      } as never,
    ]);
    mockListKcScaffolds.mockResolvedValue([
      { id: 's1', kcId, kind: 'worked_example', level: 1, title: 'Venturi basics', body: 'Worked example body.', details: {}, sortOrder: 0, source: 'seed', createdAt: Date.now() } as never,
    ]);

    const convo = await createConversation(db, userId, {
      kc_id: kcId,
      mode: 'absorb',
      details: { flow: 'absorb', focus_order: [prereqKcId] },
    });

    const getSentBody = mockStreamingFetch("Let's start with fluid velocity — what happens to it as a pipe narrows?");
    const stream = await appendMessageAndStream(db, userId, convo.id, 'Ready to learn Bernoulli', AI_ENV);
    await drainToText(stream);

    expect(mockGetKcGraph).toHaveBeenCalledWith(db, userId, kcId);
    expect(mockListKcMisconceptions).toHaveBeenCalledWith(db, userId, kcId);
    expect(mockListKcScaffolds).toHaveBeenCalledWith(db, userId, kcId);

    const systemMessage = getSentBody().messages.find((m) => m.role === 'system')?.content ?? '';
    expect(systemMessage).toContain('Fluid Velocity');
    expect(systemMessage).toContain('NOT ready');
    expect(systemMessage).toContain('pressure-vs-force');
    expect(systemMessage).toContain('Venturi basics');
    expect(systemMessage).toContain('Focus order');
  });

  it('does NOT gather graph/misconceptions/scaffolds context for a non-absorb mode', async () => {
    const kcId = await makeKc('concept');
    const convo = await createConversation(db, userId, { kc_id: kcId });

    mockStreamingFetch('A classification question.');
    const stream = await appendMessageAndStream(db, userId, convo.id, 'Hi', AI_ENV);
    await drainToText(stream);

    expect(mockGetKcGraph).not.toHaveBeenCalled();
    expect(mockListKcMisconceptions).not.toHaveBeenCalled();
    expect(mockListKcScaffolds).not.toHaveBeenCalled();
  });
});

describe('appendMessageAndStream — absorb message cap', () => {
  it('exposes a higher cap for absorb conversations and does not cap at the standard 30-message mark', async () => {
    expect(MAX_MESSAGES_PER_CONVERSATION_ABSORB).toBeGreaterThan(30);

    const kcId = await makeKc('principle');
    const convo = await createConversation(db, userId, { kc_id: kcId, mode: 'absorb', details: { flow: 'absorb' } });

    for (let i = 0; i < 30; i++) {
      await db.insert(tutorMessages).values({
        id: crypto.randomUUID(),
        conversationId: convo.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `message ${i}`,
      });
    }

    mockStreamingFetch('Still going.');
    const stream = await appendMessageAndStream(db, userId, convo.id, 'one more', AI_ENV);
    await expect(drainToText(stream)).resolves.not.toThrow();
  });

  it('caps an absorb conversation once it reaches MAX_MESSAGES_PER_CONVERSATION_ABSORB', async () => {
    const kcId = await makeKc('principle');
    const convo = await createConversation(db, userId, { kc_id: kcId, mode: 'absorb', details: { flow: 'absorb' } });

    for (let i = 0; i < MAX_MESSAGES_PER_CONVERSATION_ABSORB; i++) {
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
  });
});

describe('endConversation — event attribution', () => {
  it('appends the tutor_session event with source "tutor"', async () => {
    const kcId = await makeKc('rule');
    const convo = await createConversation(db, userId, { kc_id: kcId });

    const { event } = await endConversation(db, userId, convo.id, { final_rating: 4 });
    expect(event.source).toBe('tutor');

    const rows = await db.select().from(events).where(eq(events.kcId, kcId));
    const tutorEvent = rows.find((r) => r.type === 'tutor_session');
    expect(tutorEvent?.source).toBe('tutor');
  });
});
