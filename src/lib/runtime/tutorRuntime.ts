// Tutor runtime ingress.  HTTP routes use this module instead of speaking to
// D1 conversation tables: transcript and turn coordination live in exactly
// one per-learner Durable Object, while learner-model reads remain services.
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, kcs, tutorConversations, tutorMessages } from '../../db/schema';
import type { CreateConversationInput, EndConversationInput, ListConversationsQuery, TutorMode } from '../schemas/tutor';
import { createRuntimeTutorSessionEvent } from '../services/events';
import { buildTutorSystemPrompt, ConversationCapReachedError, messageCapForMode } from '../services/tutor/conversations';
import { modeForKcType } from '../services/tutor/prompts';
import { NotFoundError, requireOwnedKc } from '../services/util';
import { createLearnerReplyStreamRequest, getLearnerAgentForUser, type LearnerConversation } from './learnerAgent';

type RuntimeEnv = Pick<Cloudflare.Env, 'LEARNER_AGENT'>;

async function findConversation(agent: Awaited<ReturnType<typeof getLearnerAgentForUser>>, conversationId: string) {
  const conversation = await agent.findConversation(conversationId);
  if (!conversation) throw new NotFoundError('Conversation');
  return conversation;
}

async function agentFor(db: Db, env: RuntimeEnv, userId: string) {
  const agent = await getLearnerAgentForUser(env, userId);
  // A one-way import preserves pre-runtime transcript history without
  // retaining D1 as the ongoing conversation store.
  const legacy = await db.select().from(tutorConversations).where(eq(tutorConversations.userId, userId));
  const messages = legacy.length
    ? await db.select().from(tutorMessages).where(inArray(tutorMessages.conversationId, legacy.map((row) => row.id))).orderBy(asc(tutorMessages.createdAt))
    : [];
  const messagesByConversation = new Map<string, typeof messages>();
  for (const message of messages) {
    const list = messagesByConversation.get(message.conversationId) ?? [];
    list.push(message);
    messagesByConversation.set(message.conversationId, list);
  }
  await agent.importLegacyConversations({
    source: 'd1-tutor-conversations-v1',
    conversations: legacy.map((conversation) => ({
      id: conversation.id,
      kcId: conversation.kcId,
      mode: conversation.mode,
      details: (conversation.details ?? {}) as never,
      createdAt: conversation.createdAt,
      messages: (messagesByConversation.get(conversation.id) ?? []).map((message) => ({
        id: message.id,
        role: message.role as 'user' | 'assistant',
        content: message.content,
        createdAt: message.createdAt,
      })),
    })),
  });
  return agent;
}

function asConversation(row: LearnerConversation) {
  return {
    id: row.id,
    kcId: row.kcId,
    mode: row.mode,
    details: row.details,
    status: row.status,
    activeTurnId: row.activeTurnId,
    createdAt: row.createdAt,
    endedAt: row.endedAt,
  };
}

async function recordRuntimeTutorSession(
  db: Db,
  userId: string,
  conversation: LearnerConversation,
  input: EndConversationInput = {},
) {
  if (!conversation.kcId) throw new Error('Tutor conversation has no knowledge component');
  const kc = await requireOwnedKc(db, userId, conversation.kcId);
  return createRuntimeTutorSessionEvent(db, userId, {
    conversationId: conversation.id,
    kcId: kc.id,
    courseId: kc.courseId,
    mode: conversation.mode,
    finalRating: input.final_rating,
  });
}

/**
 * The DO finishes the assistant turn and state transition before this wrapper
 * closes the client SSE response. The D1 event therefore cannot be observed
 * before the transcript's final assistant message and ended state, and a
 * retry is safe through the D1 conversation ledger.
 */
function finaliseAfterStream(
  stream: ReadableStream<Uint8Array>,
  onDone: () => Promise<void>,
  onCancel: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let finalised = false;
  const finish = async () => {
    if (finalised) return;
    finalised = true;
    await onDone();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          await finish();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await onCancel();
    },
  });
}

export async function createRuntimeConversation(db: Db, env: RuntimeEnv, userId: string, input: CreateConversationInput) {
  const kc = await requireOwnedKc(db, userId, input.kc_id);
  const mode = (input.mode ?? modeForKcType(kc.kcType as Parameters<typeof modeForKcType>[0])) as TutorMode;
  const agent = await agentFor(db, env, userId);
  return asConversation(await agent.createConversation({ kcId: kc.id, mode, details: input.details ?? {} }));
}

export async function getRuntimeConversation(db: Db, env: RuntimeEnv, userId: string, conversationId: string) {
  const agent = await agentFor(db, env, userId);
  const conversation = await findConversation(agent, conversationId);
  if (conversation.kcId) await requireOwnedKc(db, userId, conversation.kcId);
  return { ...asConversation(conversation), messages: conversation.messages };
}

/**
 * Establishes trusted correction provenance without reintroducing a D1
 * foreign key for DO-owned transcripts. Looking up the ID in the caller's
 * deterministic learner object makes an ID from another tenant indistinguish-
 * able from a missing one; validating its KC also preserves the normal D1
 * learner/knowledge ownership boundary.
 */
export async function verifyRuntimeConversationProvenance(
  db: Db,
  env: RuntimeEnv,
  userId: string,
  conversationId: string,
): Promise<{ sourceConversationId: string }> {
  const agent = await agentFor(db, env, userId);
  const conversation = await findConversation(agent, conversationId);
  if (!conversation.kcId) throw new NotFoundError('Conversation');
  await requireOwnedKc(db, userId, conversation.kcId);
  return { sourceConversationId: conversation.id };
}

export async function listRuntimeConversations(db: Db, env: RuntimeEnv, userId: string, query: ListConversationsQuery) {
  const agent = await agentFor(db, env, userId);
  const rows = await agent.listConversations({ limit: query.limit ?? 20, kcId: query.kc });
  const kcIds = rows.flatMap((row) => (row.kcId ? [row.kcId] : []));
  if (kcIds.length === 0) return [];
  const owned = await db
    .select({ id: kcs.id, name: kcs.name, courseId: courses.id })
    .from(kcs)
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(eq(courses.userId, userId), inArray(kcs.id, kcIds)));
  const byId = new Map(owned.map((kc) => [kc.id, kc]));
  return rows
    .map((row) => {
      const kc = row.kcId ? byId.get(row.kcId) : undefined;
      if (!kc || (query.course && kc.courseId !== query.course)) return null;
      return {
        id: row.id,
        kcId: row.kcId!,
        kcName: kc.name,
        mode: row.mode,
        status: row.status,
        activeTurnId: row.activeTurnId,
        createdAt: row.createdAt,
        endedAt: row.endedAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

/**
 * Browser-safe projection of the caller's runtime coordinator. The DO remains
 * authoritative; this endpoint-shaped service only removes the immutable
 * local learner id (already represented by the authenticated session) and
 * excludes any active conversation whose KC is no longer caller-owned.
 */
export async function getLearnerRuntimeSnapshot(db: Db, env: RuntimeEnv, userId: string) {
  const agent = await agentFor(db, env, userId);
  const snapshot = await agent.getSnapshot();
  const kcIds = snapshot.activeConversations.flatMap((conversation) => (conversation.kcId ? [conversation.kcId] : []));
  const ownedKcIds = kcIds.length
    ? new Set(
        (
          await db
            .select({ id: kcs.id })
            .from(kcs)
            .innerJoin(courses, eq(kcs.courseId, courses.id))
            .where(and(eq(courses.userId, userId), inArray(kcs.id, kcIds)))
        ).map((row) => row.id),
      )
    : new Set<string>();

  return {
    activeConversations: snapshot.activeConversations
      .filter((conversation) => conversation.kcId === null || ownedKcIds.has(conversation.kcId))
      .map(asConversation),
    sessions: snapshot.sessions,
    nextAlarmAt: snapshot.nextAlarmAt,
  };
}

export async function streamRuntimeTutorReply(db: Db, env: RuntimeEnv, userId: string, conversationId: string, content: string) {
  const agent = await agentFor(db, env, userId);
  const conversation = await findConversation(agent, conversationId);
  if (!conversation.kcId) throw new Error('Tutor conversation has no knowledge component');
  const mode = conversation.mode as TutorMode;
  const messageCap = messageCapForMode(mode);
  if (conversation.messages.length >= messageCap) {
    const ended = await agent.endConversation(conversationId);
    await recordRuntimeTutorSession(db, userId, ended);
    throw new ConversationCapReachedError(messageCap);
  }
  const systemPrompt = await buildTutorSystemPrompt(db, userId, conversation.kcId, mode, conversation.details as Record<string, unknown>);
  const response = await agent.fetch(createLearnerReplyStreamRequest({ conversationId, content, systemPrompt, messageCap }));
  if (!response.ok || !response.body) throw new Error(await response.text());
  return finaliseAfterStream(
    response.body,
    async () => {
      const latest = await findConversation(agent, conversationId);
      // A completed turn closes the DO conversation only at its policy cap.
      // Failed/cancelled streams remain active and therefore append no event.
      if (latest.status === 'ended' && latest.messages.length >= messageCap) {
        await recordRuntimeTutorSession(db, userId, latest);
      }
    },
    async () => {
      await agent.cancelStreamingReply(conversationId);
    },
  );
}

export async function endRuntimeConversation(db: Db, env: RuntimeEnv, userId: string, conversationId: string, input: EndConversationInput) {
  const agent = await agentFor(db, env, userId);
  const conversation = await findConversation(agent, conversationId);
  if (!conversation.kcId) throw new Error('Tutor conversation has no knowledge component');
  const ended = await agent.endConversation(conversationId);
  const { event, masteryDeltas } = await recordRuntimeTutorSession(db, userId, ended, input);
  return { conversation: asConversation(ended), event, mastery_deltas: masteryDeltas };
}
