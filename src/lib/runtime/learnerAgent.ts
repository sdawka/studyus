import { DurableObject } from 'cloudflare:workers';
import { relayAsSSE, streamChatCompletion, type ChatMessage } from '../services/tutor/openrouter';
import { requireAiFeature } from '../ai/capabilities';
import { deliverBehavioralEventAwaited } from '../analytics/server';
import { resolveSettings } from '../services/user';
import { LEARNER_RUNTIME_NAME_PREFIX, learnerRuntimeObjectName } from '../services/accountLifecycle';
import { AiBudgetExceededError } from '../ai/errors';
export { AiBudgetExceededError } from '../ai/errors';

export const TUTOR_ABANDONMENT_IDLE_MS = 30 * 60 * 1000;
export const TUTOR_ABANDONMENT_IN_FLIGHT_RETRY_MS = 60 * 1000;
export const AI_DAILY_CALL_LIMIT = 30;
export const AI_PROVIDER_LEASE_MS = 30 * 1000;

/**
 * A learner is the tenancy boundary for state that needs strict ordering. The
 * stable local user ID, rather than an auth-provider ID, is deliberately used
 * here because all current D1 ownership relations use it.
 */
export const LEARNER_AGENT_NAME_PREFIX = LEARNER_RUNTIME_NAME_PREFIX;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type LearnerConversation = {
  id: string;
  kcId: string | null;
  mode: string;
  details: JsonValue;
  status: 'active' | 'ended';
  activeTurnId: string | null;
  createdAt: number;
  endedAt: number | null;
};

export type LearnerTutorMessage = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
};

export type LearnerConversationDetails = LearnerConversation & { messages: LearnerTutorMessage[] };

export type LearnerToolCall = {
  id: string;
  conversationId: string;
  name: string;
  input: JsonValue;
  output: JsonValue | null;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  createdAt: number;
  updatedAt: number;
};

export type LearnerScheduledAlarm = {
  id: string;
  kind: string;
  payload: JsonValue;
  scheduledAt: number;
  status: 'scheduled' | 'fired' | 'completed' | 'cancelled';
  createdAt: number;
  firedAt: number | null;
};

export type LearnerSessionState = {
  key: string;
  value: JsonValue;
  version: number;
  updatedAt: number;
};

export type LearnerAgentSnapshot = {
  learnerId: string;
  // Multiple tabs/channels may legitimately have separate active sessions.
  // Preserve the complete ordered set instead of pretending there is one
  // globally-exclusive "current" conversation.
  activeConversations: LearnerConversation[];
  sessions: LearnerSessionState[];
  nextAlarmAt: number | null;
};

/** The intentionally small, transport-safe API returned to Worker adapters. */
export interface LearnerAgentStub {
  initialize(learnerId: string): Promise<void>;
  markAccountDeleted(input: { eventId: string; deletedAt: number }): Promise<void>;
  getSnapshot(): Promise<LearnerAgentSnapshot>;
  createConversation(input: CreateLearnerConversationInput): Promise<LearnerConversation>;
  listConversations(input?: { limit?: number; kcId?: string }): Promise<LearnerConversation[]>;
  getConversation(conversationId: string): Promise<LearnerConversationDetails>;
  findConversation(conversationId: string): Promise<LearnerConversationDetails | null>;
  appendMessage(input: AppendLearnerMessageInput): Promise<LearnerTutorMessage>;
  endConversation(conversationId: string): Promise<LearnerConversation>;
  cancelStreamingReply(conversationId: string): Promise<LearnerConversation>;
  setSessionState(input: { key: string; value: JsonValue; expectedVersion?: number }): Promise<LearnerSessionState>;
  getSessionState(key: string): Promise<LearnerSessionState | null>;
  createToolCall(input: { conversationId: string; name: string; input: JsonValue }): Promise<LearnerToolCall>;
  resolveToolCall(input: { id: string; status: 'succeeded' | 'failed'; output: JsonValue }): Promise<LearnerToolCall>;
  listToolCalls(conversationId: string): Promise<LearnerToolCall[]>;
  scheduleAlarm(input: { id?: string; kind: string; payload?: JsonValue; scheduledAt: number }): Promise<LearnerScheduledAlarm>;
  listFiredAlarms(): Promise<LearnerScheduledAlarm[]>;
  completeAlarm(id: string): Promise<void>;
  importLegacyConversations(input: { source: string; conversations: LegacyLearnerConversationImport[] }): Promise<{ imported: boolean; conversationCount: number }>;
  tryReserveAiProviderCall(): Promise<LearnerAiProviderReservation>;
  tryRecordAiProviderRetry(leaseId: string): Promise<LearnerAiProviderAttemptResult>;
  releaseAiProviderCall(leaseId: string): Promise<void>;
  fetch(request: Request): Promise<Response>;
}

export type LearnerAiProviderLease = {
  id: string;
  utcDay: string;
  attemptedCalls: number;
  expiresAt: number;
};

export type LearnerAiProviderReservation =
  | { ok: true; lease: LearnerAiProviderLease }
  | { ok: false; code: AiBudgetExceededError['code']; status: AiBudgetExceededError['status'] };

export type LearnerAiProviderAttemptResult =
  | { ok: true; attemptedCalls: number }
  | { ok: false; code: AiBudgetExceededError['code']; status: AiBudgetExceededError['status'] };

export type CreateLearnerConversationInput = {
  id?: string;
  kcId?: string | null;
  mode: string;
  details?: JsonValue;
};

export type AppendLearnerMessageInput = {
  conversationId: string;
  content: string;
};

export type TutorTurnAnalyticsCorrelation = {
  sessionId: string;
  surface: '/learn/[kcId]' | '/tutor/[kcId]';
};

export type AcceptLearnerTutorTurnInput = AppendLearnerMessageInput & {
  analytics?: TutorTurnAnalyticsCorrelation;
};

export type AcceptedLearnerTutorTurn = {
  turnId: string;
  messageId: string;
  acceptedAt: number;
  turnIndex: number;
  providerLeaseId: string;
};

export type StreamLearnerReplyInput = {
  conversationId: string;
  turnId: string;
  providerLeaseId: string;
  /** A trusted domain/pedagogy adapter constructs this; it is never client input. */
  systemPrompt: string;
  /** The runtime-owned policy cap. It is never accepted from a client. */
  messageCap: number;
};

export type LegacyLearnerConversationImport = {
  id: string;
  kcId?: string | null;
  mode: string;
  details?: JsonValue;
  createdAt: number;
  endedAt?: number | null;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
  }>;
};

export class LearnerAgentNotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} was not found`);
    this.name = 'LearnerAgentNotFoundError';
  }
}

export class LearnerAgentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LearnerAgentConflictError';
  }
}

export class LearnerAgentDeletedError extends Error {
  constructor() {
    super('Learner runtime is deleted');
    this.name = 'LearnerAgentDeletedError';
  }
}

type LearnerAgentEnv = Pick<
  Cloudflare.Env,
  'AI_FEATURES_ENABLED' | 'OPENROUTER_API_KEY' | 'OPENROUTER_MODEL' | 'DB' | 'ANALYTICS_ENABLED' | 'POSTHOG_HOST' | 'POSTHOG_PROJECT_TOKEN' | 'ANALYTICS_EXCLUDED_USER_IDS'
>;

type ConversationRow = {
  id: string;
  kc_id: string | null;
  mode: string;
  details_json: string;
  status: 'active' | 'ended';
  active_turn_id: string | null;
  created_at: number;
  ended_at: number | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
};

type ToolCallRow = {
  id: string;
  conversation_id: string;
  name: string;
  input_json: string;
  output_json: string | null;
  status: LearnerToolCall['status'];
  created_at: number;
  updated_at: number;
};

type SessionStateRow = { key: string; value_json: string; version: number; updated_at: number };
type AlarmRow = {
  id: string;
  kind: string;
  payload_json: string;
  scheduled_at: number;
  status: LearnerScheduledAlarm['status'];
  created_at: number;
  fired_at: number | null;
};
type TutorAbandonmentRow = {
  conversation_id: string;
  session_id: string;
  surface: TutorTurnAnalyticsCorrelation['surface'];
  last_user_turn_at: number;
  turn_count: number;
  scheduled_at: number;
  insert_id: string;
};

function asJsonValue(value: unknown, fallback: JsonValue = {}): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => asJsonValue(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, asJsonValue(item)]));
  }
  return fallback;
}

function parseJson(value: string, fallback: JsonValue = {}): JsonValue {
  try {
    return asJsonValue(JSON.parse(value), fallback);
  } catch {
    return fallback;
  }
}

function assertNonBlank(value: string, field: string, maxLength = 4_000): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new TypeError(`${field} must be a non-empty string no longer than ${maxLength} characters`);
  }
}

function toConversation(row: ConversationRow): LearnerConversation {
  return {
    id: row.id,
    kcId: row.kc_id,
    mode: row.mode,
    details: parseJson(row.details_json),
    status: row.status,
    activeTurnId: row.active_turn_id,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };
}

function toMessage(row: MessageRow): LearnerTutorMessage {
  return { id: row.id, conversationId: row.conversation_id, role: row.role, content: row.content, createdAt: row.created_at };
}

function toToolCall(row: ToolCallRow): LearnerToolCall {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name,
    input: parseJson(row.input_json),
    output: row.output_json === null ? null : parseJson(row.output_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAlarm(row: AlarmRow): LearnerScheduledAlarm {
  return {
    id: row.id,
    kind: row.kind,
    payload: parseJson(row.payload_json),
    scheduledAt: row.scheduled_at,
    status: row.status,
    createdAt: row.created_at,
    firedAt: row.fired_at,
  };
}

/**
 * The only Durable Object with learner-owned runtime state. Domain engines
 * call its RPC surface through `getLearnerAgentForUser`; only streaming uses
 * fetch because it returns an SSE Response.
 */
export class LearnerAgent extends DurableObject<LearnerAgentEnv> {
  constructor(ctx: DurableObjectState, env: LearnerAgentEnv) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _learner_agent_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    const version = this.ctx.storage.sql
      .exec<{ version: number }>('SELECT COALESCE(MAX(id), 0) AS version FROM _learner_agent_schema_migrations')
      .one().version;

    if (version < 1) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE learner_identity (
          learner_id TEXT PRIMARY KEY,
          initialized_at INTEGER NOT NULL
        );
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          kc_id TEXT,
          mode TEXT NOT NULL,
          details_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
          active_turn_id TEXT,
          created_at INTEGER NOT NULL,
          ended_at INTEGER
        );
        CREATE INDEX conversations_created_at ON conversations(created_at DESC);
        CREATE INDEX conversations_active_turn ON conversations(active_turn_id);
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX messages_conversation_created_at ON messages(conversation_id, created_at, id);
        CREATE TABLE tool_calls (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id),
          name TEXT NOT NULL,
          input_json TEXT NOT NULL,
          output_json TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX tool_calls_conversation_created_at ON tool_calls(conversation_id, created_at);
        CREATE TABLE session_state (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          version INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE scheduled_alarms (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          scheduled_at INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('scheduled', 'fired', 'completed', 'cancelled')),
          created_at INTEGER NOT NULL,
          fired_at INTEGER
        );
        CREATE INDEX scheduled_alarms_next ON scheduled_alarms(status, scheduled_at);
        CREATE TABLE import_markers (
          source TEXT PRIMARY KEY,
          imported_at INTEGER NOT NULL
        );
        INSERT INTO _learner_agent_schema_migrations (id, applied_at) VALUES (1, ?);
      `, Date.now());
    }
    if (version < 2) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE tutor_abandonment_alarms (
          conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL,
          surface TEXT NOT NULL CHECK (surface IN ('/learn/[kcId]', '/tutor/[kcId]')),
          last_user_turn_at INTEGER NOT NULL,
          turn_count INTEGER NOT NULL,
          scheduled_at INTEGER NOT NULL,
          insert_id TEXT NOT NULL
        );
        CREATE INDEX tutor_abandonment_alarms_next ON tutor_abandonment_alarms(scheduled_at);
        INSERT INTO _learner_agent_schema_migrations (id, applied_at) VALUES (2, ?);
      `, Date.now());
    }
    if (version < 3) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE account_lifecycle (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          state TEXT NOT NULL CHECK (state IN ('active', 'deleted')),
          deletion_event_id TEXT,
          deleted_at INTEGER
        );
        INSERT INTO account_lifecycle (singleton, state) VALUES (1, 'active');
        INSERT INTO _learner_agent_schema_migrations (id, applied_at) VALUES (3, ?);
      `, Date.now());
    }
    if (version < 4) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE ai_usage_daily (
          utc_day TEXT PRIMARY KEY,
          attempted_calls INTEGER NOT NULL CHECK (attempted_calls >= 0 AND attempted_calls <= ${AI_DAILY_CALL_LIMIT})
        );
        CREATE TABLE ai_provider_lease (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          lease_id TEXT NOT NULL,
          acquired_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        ALTER TABLE conversations ADD COLUMN provider_lease_id TEXT;
        INSERT INTO _learner_agent_schema_migrations (id, applied_at) VALUES (4, ?);
      `, Date.now());
    }
  }

  /** Bind the immutable local learner ID to this deterministically named object. */
  async initialize(learnerId: string): Promise<void> {
    this.requireActive();
    assertNonBlank(learnerId, 'learnerId', 200);
    await this.requireD1AccountActive(learnerId);
    const existing = this.ctx.storage.sql.exec<{ learner_id: string }>('SELECT learner_id FROM learner_identity LIMIT 1').toArray()[0];
    if (existing && existing.learner_id !== learnerId) {
      throw new LearnerAgentConflictError('Learner runtime is already initialized for a different learner');
    }
    if (!existing) {
      this.ctx.storage.sql.exec('INSERT INTO learner_identity (learner_id, initialized_at) VALUES (?, ?)', learnerId, Date.now());
    }
  }

  /** Permanently fence this object while retaining learner-owned data for operators. */
  async markAccountDeleted(input: { eventId: string; deletedAt: number }): Promise<void> {
    assertNonBlank(input.eventId, 'eventId', 200);
    if (!Number.isFinite(input.deletedAt) || input.deletedAt <= 0) throw new TypeError('deletedAt is invalid');
    this.ctx.storage.sql.exec(
      "UPDATE account_lifecycle SET state = 'deleted', deletion_event_id = ?, deleted_at = ? WHERE singleton = 1 AND state = 'active'",
      input.eventId,
      input.deletedAt,
    );
    this.ctx.storage.sql.exec("UPDATE scheduled_alarms SET status = 'cancelled' WHERE status IN ('scheduled', 'fired')");
    this.ctx.storage.sql.exec('DELETE FROM tutor_abandonment_alarms');
    this.ctx.storage.sql.exec('UPDATE conversations SET active_turn_id = NULL, provider_lease_id = NULL WHERE active_turn_id IS NOT NULL');
    this.ctx.storage.sql.exec('DELETE FROM ai_provider_lease');
    await this.ctx.storage.deleteAlarm();
  }

  async getSnapshot(): Promise<LearnerAgentSnapshot> {
    const learnerId = await this.requireActiveLearnerId();
    const activeConversations = this.ctx.storage.sql
      .exec<ConversationRow>("SELECT id, kc_id, mode, details_json, status, active_turn_id, created_at, ended_at FROM conversations WHERE status = 'active' ORDER BY created_at DESC, id")
      .toArray()
      .map(toConversation);
    const sessions = this.ctx.storage.sql
      .exec<SessionStateRow>('SELECT key, value_json, version, updated_at FROM session_state ORDER BY key')
      .toArray()
      .map((row) => ({ key: row.key, value: parseJson(row.value_json), version: row.version, updatedAt: row.updated_at }));
    const nextAlarmAt = this.nextScheduledAlarmAt();
    return { learnerId, activeConversations, sessions, nextAlarmAt };
  }

  async createConversation(input: CreateLearnerConversationInput): Promise<LearnerConversation> {
    await this.requireActiveLearnerId();
    assertNonBlank(input.mode, 'mode', 100);
    if (input.kcId !== undefined && input.kcId !== null) assertNonBlank(input.kcId, 'kcId', 200);
    const id = input.id ?? crypto.randomUUID();
    assertNonBlank(id, 'conversation id', 200);
    const now = Date.now();
    const details = asJsonValue(input.details ?? {});
    this.ctx.storage.sql.exec(
      'INSERT INTO conversations (id, kc_id, mode, details_json, status, active_turn_id, created_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      input.kcId ?? null,
      input.mode,
      JSON.stringify(details),
      'active',
      null,
      now,
      null,
    );
    return { id, kcId: input.kcId ?? null, mode: input.mode, details, status: 'active', activeTurnId: null, createdAt: now, endedAt: null };
  }

  async listConversations(input: { limit?: number; kcId?: string } = {}): Promise<LearnerConversation[]> {
    await this.requireActiveLearnerId();
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    if (input.kcId) {
      return this.ctx.storage.sql
        .exec<ConversationRow>(
          'SELECT id, kc_id, mode, details_json, status, active_turn_id, created_at, ended_at FROM conversations WHERE kc_id = ? ORDER BY created_at DESC LIMIT ?',
          input.kcId,
          limit,
        )
        .toArray()
        .map(toConversation);
    }
    return this.ctx.storage.sql
      .exec<ConversationRow>('SELECT id, kc_id, mode, details_json, status, active_turn_id, created_at, ended_at FROM conversations ORDER BY created_at DESC LIMIT ?', limit)
      .toArray()
      .map(toConversation);
  }

  async getConversation(conversationId: string): Promise<LearnerConversationDetails> {
    await this.requireActiveLearnerId();
    const conversation = this.requireConversation(conversationId);
    const messages = this.ctx.storage.sql
      .exec<MessageRow>('SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, id', conversationId)
      .toArray()
      .map(toMessage);
    return { ...toConversation(conversation), messages };
  }

  /** Nullable lookup for a Worker ingress. Avoids serializing an expected
   * not-found exception across RPC (which Workers logs as an uncaught remote
   * rejection before the route can turn it into a 404). */
  async findConversation(conversationId: string): Promise<LearnerConversationDetails | null> {
    try {
      return await this.getConversation(conversationId);
    } catch (error) {
      if (error instanceof LearnerAgentNotFoundError) return null;
      throw error;
    }
  }

  async appendMessage(input: AppendLearnerMessageInput): Promise<LearnerTutorMessage> {
    await this.requireActiveLearnerId();
    const conversation = this.requireConversation(input.conversationId);
    this.assertCanAppend(conversation, input.content);
    const message = this.insertMessage(input.conversationId, 'user', input.content);
    return toMessage(message);
  }

  async acceptTutorTurn(input: AcceptLearnerTutorTurnInput): Promise<AcceptedLearnerTutorTurn> {
    await this.requireActiveLearnerId();
    this.recoverExpiredAiProviderLease();
    const conversation = this.requireConversation(input.conversationId);
    this.assertCanAppend(conversation, input.content);
    if (input.analytics) this.assertTutorAnalyticsCorrelation(input.analytics);
    requireAiFeature(this.env, 'tutor');
    const providerLease = await this.acquireAiProviderLease();
    const turnId = crypto.randomUUID();
    try {
      const message = this.insertMessage(input.conversationId, 'user', input.content);
      this.ctx.storage.sql.exec('UPDATE conversations SET active_turn_id = ?, provider_lease_id = ? WHERE id = ?', turnId, providerLease.id, input.conversationId);
      const turnIndex = this.ctx.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ? AND role = 'user'", input.conversationId)
        .one().count;

      if (input.analytics) {
        this.ctx.storage.sql.exec(
          `INSERT INTO tutor_abandonment_alarms
            (conversation_id, session_id, surface, last_user_turn_at, turn_count, scheduled_at, insert_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(conversation_id) DO UPDATE SET
             session_id = excluded.session_id,
             surface = excluded.surface,
             last_user_turn_at = excluded.last_user_turn_at,
             turn_count = excluded.turn_count,
             scheduled_at = excluded.scheduled_at,
             insert_id = excluded.insert_id`,
          input.conversationId,
          input.analytics.sessionId,
          input.analytics.surface,
          message.created_at,
          turnIndex,
          message.created_at + TUTOR_ABANDONMENT_IDLE_MS,
          `tutor-abandoned:${input.conversationId}:${message.id}`,
        );
        await this.rescheduleNextAlarm();
      }

      return { turnId, messageId: message.id, acceptedAt: message.created_at, turnIndex, providerLeaseId: providerLease.id };
    } catch (error) {
      await this.releaseAiProviderCall(providerLease.id);
      throw error;
    }
  }

  async endConversation(conversationId: string): Promise<LearnerConversation> {
    await this.requireActiveLearnerId();
    const conversation = this.requireConversation(conversationId);
    if (conversation.active_turn_id) throw new LearnerAgentConflictError('The conversation has a streaming reply in progress');
    if (conversation.status === 'ended') {
      await this.cancelTutorAbandonment(conversationId);
      return toConversation(conversation);
    }
    const endedAt = Date.now();
    this.ctx.storage.sql.exec("UPDATE conversations SET status = 'ended', ended_at = ? WHERE id = ?", endedAt, conversationId);
    await this.cancelTutorAbandonment(conversationId);
    return { ...toConversation(conversation), status: 'ended', endedAt };
  }

  /** Clear a client-abandoned stream without ending the learner session. */
  async cancelStreamingReply(conversationId: string): Promise<LearnerConversation> {
    await this.requireActiveLearnerId();
    const conversation = this.requireConversation(conversationId);
    if (!conversation.active_turn_id) return toConversation(conversation);
    const providerLease = this.ctx.storage.sql
      .exec<{ provider_lease_id: string | null }>('SELECT provider_lease_id FROM conversations WHERE id = ?', conversationId)
      .one().provider_lease_id;
    this.ctx.storage.sql.exec('UPDATE conversations SET active_turn_id = NULL, provider_lease_id = NULL WHERE id = ? AND active_turn_id = ?', conversationId, conversation.active_turn_id);
    if (providerLease) await this.releaseAiProviderCall(providerLease);
    return { ...toConversation(conversation), activeTurnId: null };
  }

  async setSessionState(input: { key: string; value: JsonValue; expectedVersion?: number }): Promise<LearnerSessionState> {
    await this.requireActiveLearnerId();
    assertNonBlank(input.key, 'session state key', 200);
    const existing = this.ctx.storage.sql.exec<SessionStateRow>('SELECT key, value_json, version, updated_at FROM session_state WHERE key = ?', input.key).toArray()[0];
    if (input.expectedVersion !== undefined && input.expectedVersion !== (existing?.version ?? 0)) {
      throw new LearnerAgentConflictError('Session state was updated by another command');
    }
    const version = (existing?.version ?? 0) + 1;
    const updatedAt = Date.now();
    const value = asJsonValue(input.value);
    this.ctx.storage.sql.exec(
      'INSERT INTO session_state (key, value_json, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, version = excluded.version, updated_at = excluded.updated_at',
      input.key,
      JSON.stringify(value),
      version,
      updatedAt,
    );
    return { key: input.key, value, version, updatedAt };
  }

  async getSessionState(key: string): Promise<LearnerSessionState | null> {
    await this.requireActiveLearnerId();
    assertNonBlank(key, 'session state key', 200);
    const row = this.ctx.storage.sql.exec<SessionStateRow>('SELECT key, value_json, version, updated_at FROM session_state WHERE key = ?', key).toArray()[0];
    return row ? { key: row.key, value: parseJson(row.value_json), version: row.version, updatedAt: row.updated_at } : null;
  }

  async createToolCall(input: { conversationId: string; name: string; input: JsonValue }): Promise<LearnerToolCall> {
    await this.requireActiveLearnerId();
    this.requireConversation(input.conversationId);
    assertNonBlank(input.name, 'tool name', 200);
    const now = Date.now();
    const id = crypto.randomUUID();
    const toolInput = asJsonValue(input.input);
    this.ctx.storage.sql.exec(
      'INSERT INTO tool_calls (id, conversation_id, name, input_json, output_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      input.conversationId,
      input.name,
      JSON.stringify(toolInput),
      null,
      'pending',
      now,
      now,
    );
    return { id, conversationId: input.conversationId, name: input.name, input: toolInput, output: null, status: 'pending', createdAt: now, updatedAt: now };
  }

  async resolveToolCall(input: { id: string; status: 'succeeded' | 'failed'; output: JsonValue }): Promise<LearnerToolCall> {
    await this.requireActiveLearnerId();
    const row = this.ctx.storage.sql
      .exec<ToolCallRow>('SELECT id, conversation_id, name, input_json, output_json, status, created_at, updated_at FROM tool_calls WHERE id = ?', input.id)
      .toArray()[0];
    if (!row) throw new LearnerAgentNotFoundError('Tool call');
    if (row.status === 'succeeded' || row.status === 'failed') throw new LearnerAgentConflictError('Tool call is already resolved');
    const updatedAt = Date.now();
    const output = asJsonValue(input.output);
    this.ctx.storage.sql.exec('UPDATE tool_calls SET status = ?, output_json = ?, updated_at = ? WHERE id = ?', input.status, JSON.stringify(output), updatedAt, input.id);
    return { ...toToolCall(row), status: input.status, output, updatedAt };
  }

  async listToolCalls(conversationId: string): Promise<LearnerToolCall[]> {
    await this.requireActiveLearnerId();
    this.requireConversation(conversationId);
    return this.ctx.storage.sql
      .exec<ToolCallRow>('SELECT id, conversation_id, name, input_json, output_json, status, created_at, updated_at FROM tool_calls WHERE conversation_id = ? ORDER BY created_at, id', conversationId)
      .toArray()
      .map(toToolCall);
  }

  async scheduleAlarm(input: { id?: string; kind: string; payload?: JsonValue; scheduledAt: number }): Promise<LearnerScheduledAlarm> {
    await this.requireActiveLearnerId();
    assertNonBlank(input.kind, 'alarm kind', 200);
    if (!Number.isFinite(input.scheduledAt) || input.scheduledAt <= 0) throw new TypeError('scheduledAt must be a Unix timestamp in milliseconds');
    const id = input.id ?? crypto.randomUUID();
    const createdAt = Date.now();
    const payload = asJsonValue(input.payload ?? {});
    this.ctx.storage.sql.exec(
      'INSERT INTO scheduled_alarms (id, kind, payload_json, scheduled_at, status, created_at, fired_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      input.kind,
      JSON.stringify(payload),
      input.scheduledAt,
      'scheduled',
      createdAt,
      null,
    );
    await this.rescheduleNextAlarm();
    return { id, kind: input.kind, payload, scheduledAt: input.scheduledAt, status: 'scheduled', createdAt, firedAt: null };
  }

  async listFiredAlarms(): Promise<LearnerScheduledAlarm[]> {
    await this.requireActiveLearnerId();
    return this.ctx.storage.sql
      .exec<AlarmRow>("SELECT id, kind, payload_json, scheduled_at, status, created_at, fired_at FROM scheduled_alarms WHERE status = 'fired' ORDER BY scheduled_at, id")
      .toArray()
      .map(toAlarm);
  }

  async completeAlarm(id: string): Promise<void> {
    await this.requireActiveLearnerId();
    this.ctx.storage.sql.exec("UPDATE scheduled_alarms SET status = 'completed' WHERE id = ? AND status = 'fired'", id);
    await this.rescheduleNextAlarm();
  }

  /**
   * Idempotently import legacy D1 conversation records. The adapter performing
   * the D1 read passes the local learner's rows only; the DO persists the
   * source marker so retries cannot duplicate transcripts.
   */
  async importLegacyConversations(input: { source: string; conversations: LegacyLearnerConversationImport[] }): Promise<{ imported: boolean; conversationCount: number }> {
    await this.requireActiveLearnerId();
    assertNonBlank(input.source, 'import source', 200);
    const marker = this.ctx.storage.sql.exec<{ source: string }>('SELECT source FROM import_markers WHERE source = ?', input.source).toArray()[0];
    if (marker) return { imported: false, conversationCount: 0 };

    for (const conversation of input.conversations) {
      assertNonBlank(conversation.id, 'legacy conversation id', 200);
      assertNonBlank(conversation.mode, 'legacy conversation mode', 100);
      this.ctx.storage.sql.exec(
        'INSERT OR IGNORE INTO conversations (id, kc_id, mode, details_json, status, active_turn_id, created_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        conversation.id,
        conversation.kcId ?? null,
        conversation.mode,
        JSON.stringify(asJsonValue(conversation.details ?? {})),
        conversation.endedAt === null || conversation.endedAt === undefined ? 'active' : 'ended',
        null,
        conversation.createdAt,
        conversation.endedAt ?? null,
      );
      for (const message of conversation.messages) {
        assertNonBlank(message.id, 'legacy message id', 200);
        this.ctx.storage.sql.exec(
          'INSERT OR IGNORE INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
          message.id,
          conversation.id,
          message.role,
          message.content,
          message.createdAt,
        );
      }
    }
    this.ctx.storage.sql.exec('INSERT INTO import_markers (source, imported_at) VALUES (?, ?)', input.source, Date.now());
    return { imported: true, conversationCount: input.conversations.length };
  }

  /** Reserve the account's only provider slot and charge the UTC-day budget
   * before any external request is attempted. The expiring lease recovers
   * safely if a caller disappears without releasing it. */
  async tryReserveAiProviderCall(): Promise<LearnerAiProviderReservation> {
    try {
      return { ok: true, lease: await this.acquireAiProviderLease() };
    } catch (error) {
      if (error instanceof AiBudgetExceededError) return { ok: false, code: error.code, status: error.status };
      throw error;
    }
  }

  private async acquireAiProviderLease(): Promise<LearnerAiProviderLease> {
    await this.requireActiveLearnerId();
    requireAiFeature(this.env, 'tutor');
    const now = Date.now();
    const utcDay = new Date(now).toISOString().slice(0, 10);
    const id = crypto.randomUUID();
    const expiresAt = now + AI_PROVIDER_LEASE_MS;

    this.recoverExpiredAiProviderLease(now);
    return this.ctx.storage.transactionSync(() => {
      const activeLease = this.ctx.storage.sql.exec<{ lease_id: string }>('SELECT lease_id FROM ai_provider_lease WHERE singleton = 1').toArray()[0];
      if (activeLease) throw new AiBudgetExceededError('concurrent_limit');

      const usage = this.ctx.storage.sql.exec<{ attempted_calls: number }>('SELECT attempted_calls FROM ai_usage_daily WHERE utc_day = ?', utcDay).toArray()[0];
      const attemptedCalls = usage?.attempted_calls ?? 0;
      if (attemptedCalls >= AI_DAILY_CALL_LIMIT) throw new AiBudgetExceededError('daily_limit');

      this.ctx.storage.sql.exec(
        'INSERT INTO ai_usage_daily (utc_day, attempted_calls) VALUES (?, 1) ON CONFLICT(utc_day) DO UPDATE SET attempted_calls = attempted_calls + 1',
        utcDay,
      );
      this.ctx.storage.sql.exec(
        'INSERT INTO ai_provider_lease (singleton, lease_id, acquired_at, expires_at) VALUES (1, ?, ?, ?)',
        id,
        now,
        expiresAt,
      );
      this.ctx.storage.sql.exec('DELETE FROM ai_usage_daily WHERE utc_day <> ?', utcDay);
      return { id, utcDay, attemptedCalls: attemptedCalls + 1, expiresAt };
    });
  }

  private recoverExpiredAiProviderLease(now = Date.now()): void {
    this.ctx.storage.transactionSync(() => {
      const expired = this.ctx.storage.sql
        .exec<{ lease_id: string }>('SELECT lease_id FROM ai_provider_lease WHERE singleton = 1 AND expires_at <= ?', now)
        .toArray()[0];
      if (!expired) return;
      this.ctx.storage.sql.exec(
        'UPDATE conversations SET active_turn_id = NULL, provider_lease_id = NULL WHERE provider_lease_id = ?',
        expired.lease_id,
      );
      this.ctx.storage.sql.exec('DELETE FROM ai_provider_lease WHERE singleton = 1 AND lease_id = ?', expired.lease_id);
    });
  }

  async tryRecordAiProviderRetry(leaseId: string): Promise<LearnerAiProviderAttemptResult> {
    try {
      return { ok: true, attemptedCalls: await this.recordAiProviderRetry(leaseId) };
    } catch (error) {
      if (error instanceof AiBudgetExceededError) return { ok: false, code: error.code, status: error.status };
      throw error;
    }
  }

  private async recordAiProviderRetry(leaseId: string): Promise<number> {
    await this.requireActiveLearnerId();
    assertNonBlank(leaseId, 'AI provider lease id', 200);
    const now = Date.now();
    const utcDay = new Date(now).toISOString().slice(0, 10);
    return this.ctx.storage.transactionSync(() => {
      const lease = this.ctx.storage.sql
        .exec<{ lease_id: string; expires_at: number }>('SELECT lease_id, expires_at FROM ai_provider_lease WHERE singleton = 1')
        .toArray()[0];
      if (!lease || lease.lease_id !== leaseId || lease.expires_at <= now) throw new AiBudgetExceededError('concurrent_limit');
      const usage = this.ctx.storage.sql.exec<{ attempted_calls: number }>('SELECT attempted_calls FROM ai_usage_daily WHERE utc_day = ?', utcDay).toArray()[0];
      const attemptedCalls = usage?.attempted_calls ?? 0;
      if (attemptedCalls >= AI_DAILY_CALL_LIMIT) throw new AiBudgetExceededError('daily_limit');
      this.ctx.storage.sql.exec(
        'INSERT INTO ai_usage_daily (utc_day, attempted_calls) VALUES (?, 1) ON CONFLICT(utc_day) DO UPDATE SET attempted_calls = attempted_calls + 1',
        utcDay,
      );
      this.ctx.storage.sql.exec('DELETE FROM ai_usage_daily WHERE utc_day <> ?', utcDay);
      return attemptedCalls + 1;
    });
  }

  async releaseAiProviderCall(leaseId: string): Promise<void> {
    assertNonBlank(leaseId, 'AI provider lease id', 200);
    this.ctx.storage.sql.exec('DELETE FROM ai_provider_lease WHERE singleton = 1 AND lease_id = ?', leaseId);
  }

  /** Fetch is intentionally reserved for response streaming; use RPC for every other command. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || (url.pathname !== '/accept' && url.pathname !== '/stream')) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    try {
      if (url.pathname === '/accept') {
        const input = await request.json<AcceptLearnerTutorTurnInput>();
        return Response.json(await this.acceptTutorTurn(input));
      }
      const input = await request.json<StreamLearnerReplyInput>();
      await this.requireActiveLearnerId();
      assertNonBlank(input.conversationId, 'conversationId', 200);
      assertNonBlank(input.turnId, 'turnId', 200);
      assertNonBlank(input.providerLeaseId, 'providerLeaseId', 200);
      assertNonBlank(input.systemPrompt, 'systemPrompt', 24_000);
      if (!Number.isInteger(input.messageCap) || input.messageCap < 2 || input.messageCap > 200) {
        throw new TypeError('messageCap must be an integer between 2 and 200');
      }
      const stream = await this.streamReply(input);
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      });
    } catch (error) {
      const status = error instanceof LearnerAgentDeletedError
        ? 410
        : error instanceof LearnerAgentNotFoundError
          ? 404
          : error instanceof AiBudgetExceededError
            ? error.status
            : error instanceof LearnerAgentConflictError
              ? 409
              : 400;
      return Response.json(
        {
          error: error instanceof Error ? error.message : 'Invalid streaming request',
          ...(error instanceof AiBudgetExceededError ? { code: error.code } : {}),
        },
        { status },
      );
    }
  }

  async alarm(): Promise<void> {
    try {
      await this.requireActiveLearnerId();
    } catch (error) {
      if (!(error instanceof LearnerAgentDeletedError)) throw error;
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "UPDATE scheduled_alarms SET status = 'fired', fired_at = ? WHERE status = 'scheduled' AND scheduled_at <= ?",
      now,
      now,
    );
    await this.deliverDueTutorAbandonments(now);
    await this.rescheduleNextAlarm();
  }

  private async streamReply(input: StreamLearnerReplyInput): Promise<ReadableStream<Uint8Array>> {
    const learnerId = await this.requireActiveLearnerId();
    const conversation = this.requireConversation(input.conversationId);
    if (conversation.status !== 'active') throw new LearnerAgentConflictError('The conversation has ended');
    if (conversation.active_turn_id !== input.turnId) throw new LearnerAgentConflictError('The accepted tutor turn is no longer active');
    const lease = this.ctx.storage.sql
      .exec<{ lease_id: string; expires_at: number }>('SELECT lease_id, expires_at FROM ai_provider_lease WHERE singleton = 1')
      .toArray()[0];
    if (!lease || lease.lease_id !== input.providerLeaseId || lease.expires_at <= Date.now()) {
      throw new LearnerAgentConflictError('The AI provider lease is no longer active');
    }
    const conversationLease = this.ctx.storage.sql
      .exec<{ provider_lease_id: string | null }>('SELECT provider_lease_id FROM conversations WHERE id = ?', input.conversationId)
      .one().provider_lease_id;
    if (conversationLease !== input.providerLeaseId) throw new LearnerAgentConflictError('The tutor turn does not own this AI provider lease');
    requireAiFeature(this.env, 'tutor');
    const turnId = input.turnId;

    const existingMessages = this.ctx.storage.sql
      .exec<MessageRow>('SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, id', input.conversationId)
      .toArray()
      .map(toMessage);
    const history: ChatMessage[] = [
      { role: 'system', content: input.systemPrompt },
      ...existingMessages.map((message) => ({ role: message.role, content: message.content })),
    ];

    let finalised = false;
    const finalise = async (status: 'completed' | 'failed', text?: string) => {
      if (finalised) return;
      finalised = true;
      try {
        await this.requireD1AccountActive(learnerId);
        if (status === 'completed') {
          this.insertMessage(input.conversationId, 'assistant', text?.trim() || "Sorry, I didn't get a reply that time — could you try again?");
        }
        this.ctx.storage.sql.exec('UPDATE conversations SET active_turn_id = NULL, provider_lease_id = NULL WHERE id = ? AND active_turn_id = ?', input.conversationId, turnId);
        if (status === 'completed') {
          const messageCount = this.ctx.storage.sql
            .exec<{ count: number }>('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?', input.conversationId)
            .one().count;
          if (messageCount >= input.messageCap) {
            this.ctx.storage.sql.exec(
              "UPDATE conversations SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'active'",
              Date.now(),
              input.conversationId,
            );
            this.ctx.storage.sql.exec('DELETE FROM tutor_abandonment_alarms WHERE conversation_id = ?', input.conversationId);
            this.ctx.waitUntil(this.rescheduleNextAlarm());
          }
        }
      } finally {
        await this.releaseAiProviderCall(input.providerLeaseId);
      }
    };

    try {
      await this.requireD1AccountActive(learnerId);
      const upstream = await streamChatCompletion({
        apiKey: this.env.OPENROUTER_API_KEY,
        model: this.env.OPENROUTER_MODEL,
        messages: history,
        deadlineAt: lease.expires_at,
      });
      await this.requireD1AccountActive(learnerId);
      const relay = relayAsSSE(upstream, {
        onDone: (text) => finalise('completed', text),
        onError: () => finalise('failed'),
      });
      return this.withCancellationFinalizer(relay, () => finalise('failed'));
    } catch (error) {
      await finalise('failed');
      throw error;
    }
  }

  private withCancellationFinalizer(stream: ReadableStream<Uint8Array>, onCancel: () => Promise<void> | void): ReadableStream<Uint8Array> {
    const reader = stream.getReader();
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
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

  private requireLearnerId(): string {
    this.requireActive();
    const row = this.ctx.storage.sql.exec<{ learner_id: string }>('SELECT learner_id FROM learner_identity LIMIT 1').toArray()[0];
    if (!row) throw new LearnerAgentConflictError('Learner runtime has not been initialized');
    return row.learner_id;
  }

  private async requireActiveLearnerId(): Promise<string> {
    const learnerId = this.requireLearnerId();
    await this.requireD1AccountActive(learnerId);
    return learnerId;
  }

  private async requireD1AccountActive(learnerId: string): Promise<void> {
    this.requireActive();
    await assertAiProviderAccountActive(this.env, learnerId);
    this.requireActive();
  }

  private isActive(): boolean {
    return this.ctx.storage.sql.exec<{ state: string }>('SELECT state FROM account_lifecycle WHERE singleton = 1').one().state === 'active';
  }

  private requireActive(): void {
    if (!this.isActive()) throw new LearnerAgentDeletedError();
  }

  private requireConversation(conversationId: string): ConversationRow {
    assertNonBlank(conversationId, 'conversationId', 200);
    const row = this.ctx.storage.sql
      .exec<ConversationRow>('SELECT id, kc_id, mode, details_json, status, active_turn_id, created_at, ended_at FROM conversations WHERE id = ?', conversationId)
      .toArray()[0];
    if (!row) throw new LearnerAgentNotFoundError('Conversation');
    return row;
  }

  private assertCanAppend(conversation: ConversationRow, content: string): void {
    assertNonBlank(content, 'content');
    if (conversation.status !== 'active') throw new LearnerAgentConflictError('The conversation has ended');
    if (conversation.active_turn_id) throw new LearnerAgentConflictError('The conversation already has a streaming reply in progress');
  }

  private assertTutorAnalyticsCorrelation(correlation: TutorTurnAnalyticsCorrelation): void {
    assertNonBlank(correlation.sessionId, 'analytics sessionId', 160);
    if (!/^[A-Za-z0-9:_-]+$/.test(correlation.sessionId)) throw new TypeError('analytics sessionId is invalid');
    if (correlation.surface !== '/learn/[kcId]' && correlation.surface !== '/tutor/[kcId]') {
      throw new TypeError('analytics surface is invalid');
    }
  }

  private insertMessage(conversationId: string, role: LearnerTutorMessage['role'], content: string): MessageRow {
    // Transcript ordering is part of the learner runtime contract. Millisecond
    // clocks can collide for the user/assistant pair, so advance monotonically
    // within a conversation instead of using a random UUID as a tie-breaker.
    const previous = this.ctx.storage.sql
      .exec<{ created_at: number }>('SELECT created_at FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', conversationId)
      .toArray()[0];
    const createdAt = Math.max(Date.now(), (previous?.created_at ?? 0) + 1);
    const row: MessageRow = { id: crypto.randomUUID(), conversation_id: conversationId, role, content, created_at: createdAt };
    this.ctx.storage.sql.exec('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)', row.id, row.conversation_id, row.role, row.content, row.created_at);
    return row;
  }

  private nextScheduledAlarmAt(): number | null {
    const generic = this.ctx.storage.sql
      .exec<{ scheduled_at: number | null }>("SELECT MIN(scheduled_at) AS scheduled_at FROM scheduled_alarms WHERE status = 'scheduled'")
      .toArray()[0]?.scheduled_at ?? null;
    const tutor = this.ctx.storage.sql
      .exec<{ scheduled_at: number | null }>('SELECT MIN(scheduled_at) AS scheduled_at FROM tutor_abandonment_alarms')
      .toArray()[0]?.scheduled_at ?? null;
    if (generic === null) return tutor;
    if (tutor === null) return generic;
    return Math.min(generic, tutor);
  }

  private async cancelTutorAbandonment(conversationId: string): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM tutor_abandonment_alarms WHERE conversation_id = ?', conversationId);
    await this.rescheduleNextAlarm();
  }

  /**
   * Deliver only the explicitly authorized inactivity fields. Transcript text,
   * names, notes, and answers never enter this table or transport payload.
   */
  private async deliverDueTutorAbandonments(now: number): Promise<void> {
    const learnerId = this.requireLearnerId();
    const due = this.ctx.storage.sql
      .exec<TutorAbandonmentRow>(
        'SELECT conversation_id, session_id, surface, last_user_turn_at, turn_count, scheduled_at, insert_id FROM tutor_abandonment_alarms WHERE scheduled_at <= ? ORDER BY scheduled_at, conversation_id',
        now,
      )
      .toArray();
    for (const pending of due) {
      const conversation = this.ctx.storage.sql
        .exec<ConversationRow>('SELECT id, kc_id, mode, details_json, status, active_turn_id, created_at, ended_at FROM conversations WHERE id = ?', pending.conversation_id)
        .toArray()[0];
      if (!conversation || conversation.status !== 'active' || now - pending.last_user_turn_at < TUTOR_ABANDONMENT_IDLE_MS) {
        this.ctx.storage.sql.exec('DELETE FROM tutor_abandonment_alarms WHERE conversation_id = ?', pending.conversation_id);
        continue;
      }
      if (conversation.active_turn_id) {
        this.ctx.storage.sql.exec(
          'UPDATE tutor_abandonment_alarms SET scheduled_at = ? WHERE conversation_id = ?',
          now + TUTOR_ABANDONMENT_IN_FLIGHT_RETRY_MS,
          pending.conversation_id,
        );
        continue;
      }

      const user = await this.env.DB.prepare('SELECT settings FROM users WHERE id = ? LIMIT 1')
        .bind(learnerId)
        .first<{ settings: string | Record<string, unknown> }>();
      let rawSettings: unknown = user?.settings;
      if (typeof rawSettings === 'string') {
        try {
          rawSettings = JSON.parse(rawSettings);
        } catch {
          rawSettings = {};
        }
      }
      const analyticsOptOut = !user || resolveSettings(rawSettings).analytics_opt_out;
      await this.requireD1AccountActive(learnerId);
      await deliverBehavioralEventAwaited(
        { env: this.env, user_id: learnerId, analytics_opt_out: analyticsOptOut },
        {
          name: 'tutor_abandoned',
          user_id: learnerId,
          session_id: pending.session_id,
          surface: pending.surface,
          ts: now,
          conversation_id: pending.conversation_id,
          turn_count: Math.min(100_000, Math.max(0, pending.turn_count)),
          elapsed_ms: Math.min(86_400_000, Math.max(0, now - conversation.created_at)),
        },
        { insert_id: pending.insert_id },
      );
      await this.requireD1AccountActive(learnerId);
      // Transport failures throw before deletion, so the platform retries the
      // same insert id. Config/privacy rejection is a terminal no-op.
      this.ctx.storage.sql.exec('DELETE FROM tutor_abandonment_alarms WHERE conversation_id = ?', pending.conversation_id);
    }
  }

  private async rescheduleNextAlarm(): Promise<void> {
    const next = this.nextScheduledAlarmAt();
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }
}

export function learnerAgentObjectName(userId: string): string {
  return learnerRuntimeObjectName(userId);
}

/**
 * The server-side ingress should call this only after it has authenticated and
 * resolved the caller to their immutable local user ID. Clients never receive
 * a namespace, object name, or Durable Object ID.
 */
export async function getLearnerAgentForUser(
  env: Pick<Cloudflare.Env, 'LEARNER_AGENT'>,
  userId: string,
): Promise<LearnerAgentStub> {
  const stub = env.LEARNER_AGENT.getByName(learnerAgentObjectName(userId));
  await stub.initialize(userId);
  return stub as unknown as LearnerAgentStub;
}

export async function assertAiProviderAccountActive(
  env: Pick<Cloudflare.Env, 'DB'>,
  userId: string,
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT u.account_state AS account_state, r.state AS runtime_state
     FROM users u
     INNER JOIN learner_runtime_registry r ON r.user_id = u.id
     WHERE u.id = ?
     LIMIT 1`,
  ).bind(userId).first<{ account_state: string; runtime_state: string }>();
  if (!row || row.account_state !== 'active' || row.runtime_state !== 'active') throw new LearnerAgentDeletedError();
}

export async function withLearnerAiProviderLease<T>(
  env: Pick<Cloudflare.Env, 'LEARNER_AGENT' | 'DB'>,
  userId: string,
  providerWork: (lease: LearnerAiProviderLease, learner: LearnerAgentStub) => Promise<T>,
): Promise<T> {
  const learner = await getLearnerAgentForUser(env, userId);
  const reservation = await learner.tryReserveAiProviderCall();
  if (!reservation.ok) throw new AiBudgetExceededError(reservation.code);
  const lease = reservation.lease;
  try {
    await assertAiProviderAccountActive(env, userId);
    return await providerWork(lease, learner);
  } finally {
    await learner.releaseAiProviderCall(lease.id);
  }
}

/** Build the internal request used by a protected Worker route to relay SSE. */
export function createLearnerReplyStreamRequest(input: StreamLearnerReplyInput): Request {
  return new Request('https://learner-agent.internal/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function createLearnerTutorTurnAcceptanceRequest(input: AcceptLearnerTutorTurnInput): Request {
  return new Request('https://learner-agent.internal/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
