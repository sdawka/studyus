# AI Tutor Architecture

## Overview

The AI tutor is a **server-side SSE stream** that adapts its pedagogy by KC type. It's headless (a service + HTTP endpoint) so Flue agents can also invoke it.

## Integration Points

- **Endpoint**: `POST /api/v1/tutor/conversations/:id/messages` (SSE stream; message body includes user input).
- **Service**: `src/lib/services/tutor/` (openrouter.ts, prompts.ts, modelSpec.ts).
- **UI**: `ScaffoldChat.svelte` (streaming text) + `InteractiveModel.svelte` (parsed JSON model spec).
- **Event**: Closing a conversation appends a `tutor_session` event to the log.

## Mode Selection by KC Type

The tutor's behavior is determined by the KC's `kc_type` (see `docs/architecture/events-and-mastery.md`):

| kc_type | Mode | LLM Task |
|---------|------|----------|
| `fact` / `association` | `recall` | Generate flashcard-style questions + immediate feedback. |
| `concept` | `classify` | Pose classification problems with variable conditions; provide feature-focusing feedback. |
| `rule` | `worked_example` | Show worked example, then scaffold student's solution via hints/fading. |
| `principle` | `self_explain` + `interactive_model` | (A) Dialogue that probes student's reasoning. (B) Emit a model spec (parameters, constraints) for interactive exploration. |

Each mode ends with a **retrieval prompt**: "Now, can you explain to me...?" or "What would happen if...?" — enforcing the asymmetry hypothesis (spaced retrieval works everywhere).

## OpenRouter Integration

- **Fetcher**: `src/lib/services/tutor/openrouter.ts` calls OpenRouter API with `stream: true`.
- **Model**: Controlled by `OPENROUTER_MODEL` environment variable (set in `wrangler.jsonc` or `.dev.vars`). Default: `openai/gpt-4o-mini` (cheap, capable).
- **Cost bounding**: Per-conversation message cap (e.g., 100 messages) to control spend.
- **ReadableStream**: Workers-native streaming; piped through HTTP response as Server-Sent Events.

```typescript
// Pseudo-code
const stream = await fetch('https://openrouter.io/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENROUTER_KEY}`,
    'HTTP-Referer': 'https://studybuddy.local',
  },
  body: JSON.stringify({
    model: OPENROUTER_MODEL,
    stream: true,
    messages: conversationHistory,
    temperature: 0.7,
  }),
});

// Pipe stream to response as SSE
response.body.pipe(res);
```

## Context Assembly

Before sending a prompt to the LLM, the tutor assembles rich context server-side:

```typescript
const context = {
  kcName: kc.name,
  kcType: kc.kc_type,
  kcDescription: kc.description,
  branchName: branch.name,
  courseTitle: course.title,
  courseOverview: course.overview,
  currentMastery: kc.mastery,
  currentStatus: kc.status,
  recentEvents: [...last 5 events for this KC], // timestamps, types, scores
  linkedNotes: [...linked notes truncated to 500 chars],
  linkedResources: [...linked resource titles + URLs],
};
```

This context is injected into the system prompt. For example:

```
You are a Socratic tutor helping a ChemEng student master "SN2 Mechanism" 
(a rule-type KC: variable application, variable response).

Current mastery: 45% (in_progress).
Recent events: quiz_taken (60%), practice_done, reading_done.

The student has linked notes on reaction mechanisms and a video link.
Their course is "Organic Chemistry I" taught by Prof. Smith.

Today, we're working on SN2. Your goal: help them understand *when* to apply SN2 
(variable condition) and *how* to draw the mechanism (variable response), 
ending with a worked example and fading.

[Rest of mode-specific prompt]
```

## Prompt Strategies by Mode

### recall (fact / association)
Flashcard-style retrieval practice with spacing and difficulty adaptation.

```
You are drilling "{kc.name}" with a student. 
Question: {generate question from kc.description and practice_notes}
Listen to the student's answer.
If correct: brief encouragement + new question (gradually harder).
If incorrect: provide correct answer + brief explanation + easier question.
End: "Can you explain this concept in your own words?"
```

### classify (concept)
Classification exercises with variable conditions and feature-focusing feedback.

```
You are teaching classification of "{kc.name}".
Generate a classification problem (2–3 options) with variable context.
When student answers:
- If correct: acknowledge + highlight discriminative features
- If incorrect: ask guiding questions about key features
End each turn with a new scenario.
```

### worked_example (rule)
Fading worked examples: show full solution, then scaffold student work.

```
You are teaching the procedure "{kc.name}".
Phase 1: Show a complete worked example with explanation of each step.
Phase 2: Give student a similar problem; show solution steps 1–N, ask them to complete N+1–M.
Phase 3: Give student a new problem; ask them to solve it alone. Provide hints only on request.
Gradually increase student responsibility as they improve.
```

### self_explain + interactive_model (principle)
Socratic dialogue + parameter-adjustable model.

```
You are helping a student understand "{kc.name}" (a principle with rationale).
Use Socratic questioning to probe their understanding:
- "Why do you think this happens?"
- "What would change if we adjusted {parameter}?"

After 3–4 exchanges, emit a JSON model spec that the UI can render:
{
  "parameters": [
    {"name": "velocity", "min": 0, "max": 100, "unit": "m/s", "description": "Flow speed"}
  ],
  "constraints": [
    "pressure + (0.5 * rho * v^2) + rho * g * h = constant"
  ],
  "questions": [
    "If velocity doubles, how does pressure change?"
  ]
}

After the model is explored, ask: "Explain why the equation holds."
```

## Interactive Model Parsing

When the LLM emits a fenced JSON block (e.g., ` ```json {...} ``` `), the client:

1. **Parses the model spec** (parameters, constraints, questions).
2. **Renders sliders** for each parameter.
3. **Evaluates constraints** using a safe expression evaluator (no `eval`; use a library like `math.js`).
4. **Updates visualizations** on slider change.
5. **Degrades gracefully**: if parsing fails, treat the entire response as prose (scaffold chat).

Example rendered component:
```
Bernoulli's Equation
Explore the relationship between velocity, pressure, and height.

[velocity: ====|==== (25 m/s)]
[height: ==|======== (5 m)]

Pressure: 75,432 Pa
Constraint check: ✓ constant = 101,325 Pa

Question: If velocity doubles, pressure will:
  ( ) increase ( ) decrease (*) stay the same
```

## Conversation Lifecycle

1. **Create**: `POST /api/v1/tutor/conversations` → creates a `tutor_conversations` record with `kc_id` and `mode`.
2. **Message stream**: `POST /api/v1/tutor/conversations/:id/messages` with `{content: "..."}` → returns SSE stream.
   - Server streams tutor responses in real-time.
   - Client appends each message to `tutor_messages`.
3. **Close**: User clicks "End conversation" → append a `tutor_session` event with `transcript_id`, `mode`, `final_rating` (1–5 self-assessment).

Transcripts persist in `tutor_messages` for resume or review.

## Cost & Safety

- **Per-conversation cap**: Max 100 messages per conversation (configurable) to prevent runaway costs.
- **Model selection**: Cheap models (gpt-4o-mini) for v1; upgrade path to better models if needed.
- **Prompt injection**: Validate user input; never inject user text directly into constraints.
- **Expression safety**: Use `math.js` or similar for safe constraint evaluation (no `eval`).

## TODO

- **Adaptive difficulty**: Track student performance within a conversation; adjust question complexity.
- **Mode switching**: Allow tutor to suggest switching modes mid-conversation if the student isn't progressing.
- **Multi-turn planning**: Let the tutor plan a multi-turn lesson arc (e.g., "first we'll do 2 classification problems, then a worked example").
- **Knowledge map integration**: Use prerequisite edges to proactively teach foundational KCs.
