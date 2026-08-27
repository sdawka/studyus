// Tutor conversation lifecycle: create (derives mode from kc_type), get
// (with messages), append a user message + stream the assistant reply, and
// end (appends the dual-role `tutor_session` event via the events service —
// the only place event rows are written, per docs/api.md's "Notes for M2+
// agents"). Message persistence for the streamed assistant reply happens
// inside the SSE relay's onDone callback (see openrouter.ts) — the Workers
// response body isn't considered fully sent until that stream closes, so
// the write completes before the request is done even without an explicit
// ExecutionContext/waitUntil wired up yet.
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client';
import { branches, courses, kcs, notes, noteLinks, tutorConversations, tutorMessages } from '../../../db/schema';
import type { KcType } from '../../schemas/kcs';
import type {
  ConversationDetailsInput,
  CreateConversationInput,
  EndConversationInput,
  ListConversationsQuery,
  TutorMode,
} from '../../schemas/tutor';
import { createEvent, getKcEvents } from '../events';
import { getKcGraph, listKcMisconceptions, listKcScaffolds } from '../knowledgeMap';
import { NotFoundError, requireOwnedKc } from '../util';
import { buildSystemPrompt, modeForKcType, type AbsorbMisconception, type AbsorbPrereq, type AbsorbScaffold, type TutorContext } from './prompts';
import { relayAsSSE, streamChatCompletion, type ChatMessage } from './openrouter';
import { requireAiFeature } from '../../ai/capabilities';

export const MAX_MESSAGES_PER_CONVERSATION = 30;

// Absorb arcs walk 4 stages (prereq check -> synthesis -> misconception
// probing -> correction proposals) across potentially several prereqs, so a
// realistic arc needs more room than a single-mode conversation — e.g. 3
// not-ready prereqs alone can take 6+ exchanges before Stage B even starts.
// Doubling the standard cap keeps the same cost-bounding intent (a hard
// server-enforced ceiling, not just a UI suggestion) while giving the longer
// arc space to actually complete.
export const MAX_MESSAGES_PER_CONVERSATION_ABSORB = 60;

function capFor(mode: TutorMode): number {
  return mode === 'absorb' ? MAX_MESSAGES_PER_CONVERSATION_ABSORB : MAX_MESSAGES_PER_CONVERSATION;
}

/** Runtime-facing cap lookup. The Durable Object owns transcript state while
 * this service remains the single source for the tutor policy. */
export function messageCapForMode(mode: TutorMode): number {
  return capFor(mode);
}

export class ConversationCapReachedError extends Error {
  constructor(cap: number = MAX_MESSAGES_PER_CONVERSATION) {
    super(`This conversation has reached its ${cap}-message cap — please end it and start a fresh one.`);
    this.name = 'ConversationCapReachedError';
  }
}

type TutorEnv = { AI_FEATURES_ENABLED?: string; OPENROUTER_API_KEY?: string; OPENROUTER_MODEL: string };

export async function createConversation(db: Db, userId: string, input: CreateConversationInput) {
  const kc = await requireOwnedKc(db, userId, input.kc_id);
  const mode: TutorMode = input.mode ?? modeForKcType(kc.kcType as KcType);

  const id = crypto.randomUUID();
  await db.insert(tutorConversations).values({ id, userId, kcId: kc.id, mode, details: input.details ?? {} });

  const rows = await db.select().from(tutorConversations).where(eq(tutorConversations.id, id)).limit(1);
  return rows[0];
}

// Powers the course Play tab's "past explorations" list: newest-first
// conversations for the caller, optionally scoped to a course (via the
// conversation's kc) or a single kc, with kc_name joined in for display.
export async function listConversations(db: Db, userId: string, query: ListConversationsQuery) {
  const conditions = [eq(tutorConversations.userId, userId)];
  if (query.kc) conditions.push(eq(tutorConversations.kcId, query.kc));
  if (query.course) conditions.push(eq(kcs.courseId, query.course));

  const rows = await db
    .select({
      id: tutorConversations.id,
      kcId: tutorConversations.kcId,
      kcName: kcs.name,
      mode: tutorConversations.mode,
      createdAt: tutorConversations.createdAt,
    })
    .from(tutorConversations)
    .innerJoin(kcs, eq(kcs.id, tutorConversations.kcId))
    .where(and(...conditions))
    .orderBy(desc(tutorConversations.createdAt))
    .limit(query.limit ?? 20);

  return rows;
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

// getKcGraph/listKcMisconceptions/listKcScaffolds (../knowledgeMap) return
// rows shaped to mirror their respective GET response contracts in
// docs/api.md (snake_case field names like kc_id/kc_type/root_cause) — but
// since that module is built on a parallel track, these mappers accept
// either casing defensively (camelCase Drizzle-row style or snake_case
// API-shaped style) so this file doesn't silently break on a casing choice
// made after this was written.
function field(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] !== undefined ? row[camel] : row[snake];
}

function toAbsorbPrereq(node: Record<string, unknown>): AbsorbPrereq {
  return {
    kcId: field(node, 'kcId', 'kc_id') as string,
    slug: (node.slug ?? null) as string | null,
    name: node.name as string,
    kcType: field(node, 'kcType', 'kc_type') as KcType,
    mastery: (node.mastery as number) ?? 0,
    status: (node.status as string) ?? 'not-started',
    ready: Boolean(node.ready),
    depth: (node.depth as number) ?? 0,
  };
}

function toAbsorbMisconception(row: Record<string, unknown>): AbsorbMisconception {
  return {
    slug: row.slug as string,
    name: row.name as string,
    description: row.description as string,
    rootCause: field(row, 'rootCause', 'root_cause') as string,
    diagnosticProbe: field(row, 'diagnosticProbe', 'diagnostic_probe') as string,
    correction: row.correction as string,
  };
}

function toAbsorbScaffold(row: Record<string, unknown>): AbsorbScaffold {
  return {
    kind: row.kind as string,
    level: row.level as number,
    title: row.title as string,
    body: row.body as string,
  };
}

// Orders prereqs for Stage B synthesis: any prereq the learner explicitly
// ordered via focus_order comes first (in that order), then remaining
// prereqs fall back to graph-depth ascending (nearest dependencies first).
function orderAbsorbPrereqs(prereqs: AbsorbPrereq[], focusOrder: string[]): AbsorbPrereq[] {
  const focusIndex = new Map(focusOrder.map((id, i) => [id, i]));
  return [...prereqs].sort((a, b) => {
    const ai = focusIndex.has(a.kcId) ? focusIndex.get(a.kcId)! : Infinity;
    const bi = focusIndex.has(b.kcId) ? focusIndex.get(b.kcId)! : Infinity;
    return ai !== bi ? ai - bi : a.depth - b.depth;
  });
}

async function assembleTutorContext(
  db: Db,
  userId: string,
  kc: Awaited<ReturnType<typeof requireOwnedKc>>,
  mode: TutorMode,
  details: ConversationDetailsInput | Record<string, unknown> | null | undefined,
): Promise<TutorContext> {
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

  const base: TutorContext = {
    kc: { name: kc.name, type: kc.kcType as KcType, description: kc.description, practiceNotes: kc.practiceNotes },
    branchName: branchRows[0]?.name ?? 'Unknown branch',
    course: { title: courseRows[0]?.title ?? 'Unknown course', overview: courseRows[0]?.overview ?? null },
    mastery: kc.mastery,
    status: kc.status,
    recentEvents: recentEvents.map((e) => ({ type: e.type, ts: e.ts, payload: e.payload })),
    linkedNotes: linkedNoteRows.map((n) => ({ title: n.title, body: n.body.slice(0, 500) })),
    mode,
  };

  if (mode !== 'absorb') return base;

  // details.focus_order may arrive as a plain object off the DB (JSON
  // column) rather than the validated schema type — read it defensively.
  const focusOrder = Array.isArray((details as Record<string, unknown> | null | undefined)?.focus_order)
    ? ((details as Record<string, unknown>).focus_order as string[])
    : [];

  const [graph, misconceptionRows, scaffoldRows] = await Promise.all([
    getKcGraph(db, userId, kc.id),
    listKcMisconceptions(db, userId, kc.id),
    listKcScaffolds(db, userId, kc.id),
  ]);

  const prereqs = orderAbsorbPrereqs(
    (graph.prereqs as Array<Record<string, unknown>>).map(toAbsorbPrereq),
    focusOrder,
  );

  return {
    ...base,
    absorb: {
      focusOrder,
      prereqs,
      misconceptions: (misconceptionRows as Array<Record<string, unknown>>).map(toAbsorbMisconception),
      scaffolds: (scaffoldRows as Array<Record<string, unknown>>).map(toAbsorbScaffold),
      plannedMinutes: typeof (details as Record<string, unknown> | null | undefined)?.planned_minutes === 'number'
        ? ((details as Record<string, unknown>).planned_minutes as number)
        : null,
    },
  };
}

/**
 * Builds fresh, deterministic learner context for the runtime's streamed LLM
 * turn. Keeping this outside the Durable Object preserves the invariant that
 * learner-model reads remain ordinary services, not agent state.
 */
export async function buildTutorSystemPrompt(
  db: Db,
  userId: string,
  kcId: string,
  mode: TutorMode,
  details: ConversationDetailsInput | Record<string, unknown> | null | undefined = {},
) {
  const kc = await requireOwnedKc(db, userId, kcId);
  return buildSystemPrompt(await assembleTutorContext(db, userId, kc, mode, details));
}

export async function appendMessageAndStream(
  db: Db,
  userId: string,
  conversationId: string,
  content: string,
  env: TutorEnv,
): Promise<ReadableStream<Uint8Array>> {
  requireAiFeature(env, 'tutor');
  const convo = await requireOwnedConversation(db, userId, conversationId);
  const kc = await requireOwnedKc(db, userId, convo.kcId);
  const mode = convo.mode as TutorMode;
  const cap = capFor(mode);

  const existingMessages = await db
    .select()
    .from(tutorMessages)
    .where(eq(tutorMessages.conversationId, conversationId))
    .orderBy(asc(tutorMessages.createdAt));

  if (existingMessages.length >= cap) {
    await endConversation(db, userId, conversationId, {});
    throw new ConversationCapReachedError(cap);
  }

  await db.insert(tutorMessages).values({ id: crypto.randomUUID(), conversationId, role: 'user', content });

  const ctx = await assembleTutorContext(db, userId, kc, mode, convo.details as Record<string, unknown> | null | undefined);
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
  const willReachCap = existingMessages.length + 2 >= cap;

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

  const { event, masteryDeltas } = await createEvent(
    db,
    userId,
    {
      type: 'tutor_session',
      kc_id: kc.id,
      course_id: kc.courseId,
      payload,
    },
    'tutor',
  );

  return { conversation: convo, event, mastery_deltas: masteryDeltas };
}
