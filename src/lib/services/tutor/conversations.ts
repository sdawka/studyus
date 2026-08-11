// Tutor conversation lifecycle: create (derives mode from kc_type), get
// (with messages), append a user message + stream the assistant reply, and
// end (appends the dual-role `tutor_session` event via the events service —
// the only place event rows are written, per docs/api.md's "Notes for M2+
// agents"). Message persistence for the streamed assistant reply happens
// inside the SSE relay's onDone callback (see openrouter.ts) — the Workers
// response body isn't considered fully sent until that stream closes, so
// the write completes before the request is done even without an explicit
// ExecutionContext/waitUntil wired up yet.
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client';
import { branches, courses, notes, noteLinks, tutorConversations, tutorMessages } from '../../../db/schema';
import type { KcType } from '../../schemas/kcs';
import type { CreateConversationInput, EndConversationInput, TutorMode } from '../../schemas/tutor';
import { createEvent, getKcEvents } from '../events';
import { NotFoundError, requireOwnedKc } from '../util';
import { buildSystemPrompt, modeForKcType, type TutorContext } from './prompts';
import { relayAsSSE, streamChatCompletion, type ChatMessage } from './openrouter';

export const MAX_MESSAGES_PER_CONVERSATION = 30;

export class ConversationCapReachedError extends Error {
  constructor() {
    super(`This conversation has reached its ${MAX_MESSAGES_PER_CONVERSATION}-message cap — please end it and start a fresh one.`);
    this.name = 'ConversationCapReachedError';
  }
}

type TutorEnv = { OPENROUTER_API_KEY: string; OPENROUTER_MODEL: string };

export async function createConversation(db: Db, userId: string, input: CreateConversationInput) {
  const kc = await requireOwnedKc(db, userId, input.kc_id);
  const mode: TutorMode = input.mode ?? modeForKcType(kc.kcType as KcType);

  const id = crypto.randomUUID();
  await db.insert(tutorConversations).values({ id, userId, kcId: kc.id, mode });

  const rows = await db.select().from(tutorConversations).where(eq(tutorConversations.id, id)).limit(1);
  return rows[0];
}

async function requireOwnedConversation(db: Db, userId: string, conversationId: string) {
  const rows = await db
    .select()
    .from(tutorConversations)
    .where(and(eq(tutorConversations.id, conversationId), eq(tutorConversations.userId, userId)))
    .limit(1);
  const convo = rows[0];
  if (!convo) throw new NotFoundError('Conversation');
  return convo;
}

export async function getConversation(db: Db, userId: string, conversationId: string) {
  const convo = await requireOwnedConversation(db, userId, conversationId);
  const messages = await db
    .select()
    .from(tutorMessages)
    .where(eq(tutorMessages.conversationId, conversationId))
    .orderBy(asc(tutorMessages.createdAt));
  return { ...convo, messages };
}

async function assembleTutorContext(db: Db, userId: string, kc: Awaited<ReturnType<typeof requireOwnedKc>>, mode: TutorMode): Promise<TutorContext> {
  const [branchRows, courseRows, recentEvents, linkedNoteRows] = await Promise.all([
    db.select().from(branches).where(eq(branches.id, kc.branchId)).limit(1),
    db.select().from(courses).where(eq(courses.id, kc.courseId)).limit(1),
    getKcEvents(db, userId, kc.id, { limit: 5 }),
    db
      .select({ title: notes.title, body: notes.body })
      .from(noteLinks)
      .innerJoin(notes, eq(noteLinks.noteId, notes.id))
      .where(eq(noteLinks.kcId, kc.id)),
  ]);

  return {
    kc: { name: kc.name, type: kc.kcType as KcType, description: kc.description, practiceNotes: kc.practiceNotes },
    branchName: branchRows[0]?.name ?? 'Unknown branch',
    course: { title: courseRows[0]?.title ?? 'Unknown course', overview: courseRows[0]?.overview ?? null },
    mastery: kc.mastery,
    status: kc.status,
    recentEvents: recentEvents.map((e) => ({ type: e.type, ts: e.ts, payload: e.payload })),
    linkedNotes: linkedNoteRows.map((n) => ({ title: n.title, body: n.body.slice(0, 500) })),
    mode,
  };
}

export async function appendMessageAndStream(
  db: Db,
  userId: string,
  conversationId: string,
  content: string,
  env: TutorEnv,
): Promise<ReadableStream<Uint8Array>> {
  const convo = await requireOwnedConversation(db, userId, conversationId);
  const kc = await requireOwnedKc(db, userId, convo.kcId);

  const existingMessages = await db
    .select()
    .from(tutorMessages)
    .where(eq(tutorMessages.conversationId, conversationId))
    .orderBy(asc(tutorMessages.createdAt));

  if (existingMessages.length >= MAX_MESSAGES_PER_CONVERSATION) {
    await endConversation(db, userId, conversationId, {});
    throw new ConversationCapReachedError();
  }

  await db.insert(tutorMessages).values({ id: crypto.randomUUID(), conversationId, role: 'user', content });

  const mode = convo.mode as TutorMode;
  const ctx = await assembleTutorContext(db, userId, kc, mode);
  const systemPrompt = buildSystemPrompt(ctx);

  const history: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...existingMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content },
  ];

  const upstream = await streamChatCompletion({ apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL, messages: history });

  // +1 for the user message just inserted, +1 for the assistant reply about
  // to be persisted in onDone below — if that pushes us to the cap, end the
  // conversation automatically once this exchange finishes.
  const willReachCap = existingMessages.length + 2 >= MAX_MESSAGES_PER_CONVERSATION;

  return relayAsSSE(upstream, {
    onDone: async (fullText) => {
      const text = fullText.trim().length > 0 ? fullText : "Sorry, I didn't get a reply that time — could you try again?";
      await db.insert(tutorMessages).values({ id: crypto.randomUUID(), conversationId, role: 'assistant', content: text });
      if (willReachCap) {
        await endConversation(db, userId, conversationId, {});
      }
    },
  });
}

export async function endConversation(db: Db, userId: string, conversationId: string, input: EndConversationInput) {
  const convo = await requireOwnedConversation(db, userId, conversationId);
  const kc = await requireOwnedKc(db, userId, convo.kcId);

  const payload: Record<string, unknown> = { conversation_id: conversationId, mode: convo.mode };
  if (input.final_rating !== undefined) payload.final_rating = input.final_rating;

  const { event, masteryDeltas } = await createEvent(db, userId, {
    type: 'tutor_session',
    kc_id: kc.id,
    course_id: kc.courseId,
    payload,
  });

  return { conversation: convo, event, mastery_deltas: masteryDeltas };
}
