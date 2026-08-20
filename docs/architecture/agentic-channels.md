# Agentic Flows & Channels: Flue Architecture

**Status**: Fully specced for v1 design-for; **implementation post-v1** (Flue API still experimental).

This document describes how studyus will integrate **Flue** (`@flue/server`, `@flue/client` 2.x — the Astro team's agent harness) to deliver learning across multiple channels (web, Telegram, SMS, Discord) without duplicating business logic.

## The Pattern: Services → Tools → Agents → Channels

```
┌─────────────────────────────────────────────────────────────┐
│                      Flue Worker                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Agents (Durable Objects)                             │   │
│  │  • QuizAgent (picks KCs, generates MCQs, grades)    │   │
│  │  • NotesAgent (summarizes resources, suggests study)│   │
│  └──────────────────────────────────────────────────────┘   │
│         ↓ (useTools)                                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Tools (wrap services)                                │   │
│  │  • quizService.generateQuiz()                        │   │
│  │  • eventsService.appendEvent()                       │   │
│  │  • kcsService.getTopics()                            │   │
│  └──────────────────────────────────────────────────────┘   │
│         ↓ (service bindings)                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Services (headless)                                  │   │
│  │  All logic in src/lib/services/                      │   │
│  │  No HTTP layer, no route handlers                    │   │
│  └──────────────────────────────────────────────────────┘   │
│         ↓ (database)                                         │
│                         D1 ← Event log                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Web Worker (Astro App)                     │
│  Pages call src/lib/services/ directly (server-side)         │
│  API routes also call services                               │
│  Calls Flue agents via service binding + createFlueClient    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Channel Routers                             │
│  • Telegram Bot Worker → TelegramRouter → Flue              │
│  • SMS Webhook → SMSRouter → Flue                            │
│  • Discord Bot → DiscordRouter → Flue                        │
│  (Each channel is a thin adapter; core agent is shared)      │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Separate Flue Worker
- Flue agents run in their own Worker, not embedded in the Astro app.
- **Why**: Durable Objects need a dedicated handler; agents are stateful across requests.
- Astro Worker → Flue Worker via **service binding** (internal Cloudflare request, no HTTP overhead).

### 2. Services Stay Headless
Every service function is a **pure function** `(userId, input: Zod) → output: Zod`:

```typescript
// src/lib/services/quizzes.ts
export const generateQuiz = async (
  userId: string,
  input: {
    courseId?: string;
    kcIds?: string[];
    timeMinutes: number;
  },
  env: Env, // D1, R2, etc.
): Promise<QuizDto> => {
  // 1. Fetch KCs by mastery/recency
  // 2. Call OpenRouter to generate N MCQs
  // 3. Return quiz schema
};

export const gradeQuizAnswers = async (
  userId: string,
  input: {
    quizId: string;
    answers: { questionId: string; selectedOption: number }[];
  },
  env: Env,
): Promise<{ score: 0–100; feedback: string[]; events: Event[] }> => {
  // 1. Check answers
  // 2. Append dual-role events (assessment + IE for learning)
  // 3. Recompute mastery for affected KCs
  // 4. Return score + events + mastery deltas
};
```

No HTTP layer. Callable from:
- Astro pages (direct import, pass `env` from `Astro.locals.runtime.env`).
- API routes (same).
- **Flue tools** (wrapped with input/output schemas).
- MCP servers (future).

### 3. Tools Wrap Services
Flue agents don't call services directly. Instead, they use **tools** — Zod-validated wrappers:

```typescript
// agents/tools.ts (in Flue Worker)
import { createTool } from '@flue/core';
import { generateQuiz, gradeQuizAnswers } from '../src/lib/services/quizzes';

export const quizTool = createTool({
  name: 'generateQuiz',
  description: 'Generate a personalized quiz for the student',
  input: z.object({
    courseId: z.string().optional(),
    kcIds: z.array(z.string()).optional(),
    timeMinutes: z.number().min(1).max(60),
  }),
  execute: async (input, { userId, env }) => {
    return generateQuiz(userId, input, env);
  },
});
```

### 4. D1 is Never the Agent Store
Flue agents state lives in **Durable Objects**, not D1. D1 is strictly for application data (courses, events, KCs).

Why:
- Durable Objects provide transactional isolation for agent state.
- D1 would require agents to manage their own locks/transactions.
- Agents reach application data exclusively through tools → services → D1 reads.

### 5. Channels → Agent → Tools → Services → Event Log

A "quick quiz on Telegram" flows like this:

```
Telegram message "quiz physics"
        ↓
TelegramRouter (thin adapter)
        ↓
Flue client.sendUserMessage('quiz physics')
        ↓
QuizAgent (Durable Object)
        ↓
useTools() → quizTool.execute()
        ↓
quizService.generateQuiz(userId, { course: 'physics', timeMinutes: 10 }, env)
        ↓
[Fetch top KCs by mastery, call OpenRouter, generate MCQs]
        ↓
Return quiz JSON → Agent renders to Telegram buttons
        ↓
Telegram user answers
        ↓
[Repeat: gradeQuizAnswers → append events → recompute mastery]
        ↓
"Score: 7/10. Stronger in thermodynamics, review kinetics."
        ↓
D1 event_log updated; kcs.mastery refreshed
```

## v1 Pattern-Setter: quick_quiz Flow

**quick_quiz** is the prototype agentic flow that v1 ships:

### As a Web Flow (`/study` type: "Quick quiz")
```
POST /api/v1/flows/quick_quiz
  input: { courseId?: string, kcIds?: string[], timeMinutes: number }
  output: { quizId: string, questions: Question[] }

POST /api/v1/flows/quick_quiz/:id/answers
  input: { answers: { questionId: string, selectedOption: number }[] }
  output: { score: 0–100, feedback: string[], masteryDeltas: { kcId: number }[] }
```

### As a Flue Agent Tool
Same service, same input/output, invoked by an agent:
```typescript
const quiz = await quizTool.execute({
  courseId: 'chem-213',
  timeMinutes: 15,
});

// Render to user (web scaffold, Telegram buttons, SMS menu, etc.)

const result = await gradeQuizAnswers(userId, {
  quizId: quiz.id,
  answers: userResponses,
}, env);
```

### Webhook Entry: Telegram Channel
```typescript
// telegram-router.ts (separate Worker, or function in Flue Worker)
export async function handleTelegramMessage(update) {
  const { user_id, text } = update.message;

  // Parse intent
  if (text.startsWith('/quiz')) {
    const params = text.split(' ');
    const course = params[1]; // /quiz physics → 'physics'

    // Call Flue agent
    const client = createFlueClient({ fetch: binding });
    const response = await client.sendUserMessage(user_id, text, {
      context: { channel: 'telegram', course },
    });

    // Render response as Telegram buttons
    await telegramAPI.sendMessage(user_id, response);
  }
}
```

## Implementation Roadmap (Post-v1)

### M5 Extension (M5+): Flue Integration
1. **Flue Worker scaffold**: `agents/` directory with minimal Durable Object setup.
2. **Tool wrappers**: Wrap existing services in Zod-validated tools.
3. **QuizAgent**: Implement agent that handles quiz intents (Flue demo agent).
4. **Telegram Router**: Thin webhook adapter; route messages to Flue client.
5. **quick_quiz endpoint optimization**: Benchmark and cache KC fetches.

### Post-v1 Extensions
- SMS channel (Twilio webhook).
- Discord bot.
- Email digest agent.
- Multi-turn tutoring agent (not just quizzes).

## Data Flow: Event Recording in Agentic Context

When an agent appends events (via tool), the events table captures the **channel**:

```typescript
// events.payload includes channel metadata
{
  type: 'quiz_taken',
  is_instructional: true,
  is_assessment: true,
  payload: {
    score: 75,
    max_score: 100,
    channel: 'telegram',  // or 'web', 'sms', etc.
    agent_id: 'quiz-agent-v1',
  },
  source: 'agent',
}
```

This allows analysis like: "How does Telegram quiz participation affect mastery curves?"

## Security & Scalability

- **Authentication**: Agents only operate on behalf of authenticated users (userId passed in context). Telegram/SMS channel routers verify user identity before invoking agents (e.g., Telegram user_id → studyus user_id mapping).
- **Rate limiting**: Per-user message cap + per-agent throughput limits to prevent abuse.
- **Durable Object persistence**: Agent state is persistent; conversations can span multiple messages and even survive Worker restarts.

## TODO

- Flue API stabilization (currently experimental; vAPI contract may change).
- Multi-turn dialogue planning (agents should plan a lesson arc, not just one-shot quizzes).
- Knowledge map integration (agents can suggest prerequisite KCs to study).
- Scheduling (e.g., "send me a quiz every Monday at 9am").
- Analytics dashboard (which channels drive most learning?).
