// OpenRouter chat-completions client. No provider SDK — OpenRouter is
// OpenAI-compatible, so a plain Workers-native `fetch` is enough.
//
// Two shapes are exposed:
//   - streamChatCompletion: raw upstream fetch with stream:true, returns the
//     response body ReadableStream untouched.
//   - relayAsSSE: wraps that upstream stream into our own minimal SSE format
//     ({"delta":"..."} frames, then {"done":true}) while accumulating the
//     full text so a caller can persist it once the stream finishes.
//   - chatCompletionJSON: non-streaming helper for structured generation
//     (quiz questions). Tries `response_format: json_object` first, and
//     always robustly re-parses the returned content in case a routed model
//     ignores that hint and wraps JSON in prose/fences anyway.
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
  }
}

async function callOpenRouter(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  temperature?: number;
  responseFormatJson?: boolean;
}): Promise<Response> {
  if (!opts.apiKey.trim()) {
    throw new OpenRouterError('OpenRouter is not configured', 503);
  }
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://studyus.local',
      'X-Title': 'studyus',
    },
    body: JSON.stringify({
      model: opts.model,
      stream: opts.stream,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      ...(opts.responseFormatJson ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  if (!res.ok || (opts.stream && !res.body)) {
    const text = await res.text().catch(() => '');
    throw new OpenRouterError(`OpenRouter request failed (${res.status}): ${text.slice(0, 500)}`, res.status);
  }
  return res;
}

export async function streamChatCompletion(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}): Promise<ReadableStream<Uint8Array>> {
  const res = await callOpenRouter({ ...opts, stream: true });
  return res.body as ReadableStream<Uint8Array>;
}

export type RelayCallbacks = {
  onDone?: (fullText: string) => Promise<void> | void;
  onError?: (err: unknown) => Promise<void> | void;
};

/** Re-emits an OpenAI-compatible upstream SSE byte stream as our own
 *  simplified frames, accumulating the full assistant text so `onDone` can
 *  persist it. `onDone` is awaited *before* the stream is closed, so on
 *  Workers the isolate stays alive for the persistence write even though no
 *  ExecutionContext/waitUntil is wired up yet — the response body isn't
 *  considered fully sent until this stream closes. */
export function relayAsSSE(upstream: ReadableStream<Uint8Array>, callbacks: RelayCallbacks = {}): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let fullText = '';

  function frame(obj: unknown): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
  }

  function processLine(controller: ReadableStreamDefaultController<Uint8Array>, line: string) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') return;
    try {
      const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        fullText += delta;
        controller.enqueue(frame({ delta }));
      }
    } catch {
      // Upstream occasionally sends keep-alive/comment lines that aren't
      // JSON — best-effort relay, so just skip anything unparseable.
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          if (callbacks.onDone) await callbacks.onDone(fullText);
          controller.enqueue(frame({ done: true }));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) processLine(controller, line);
      } catch (err) {
        if (callbacks.onError) await callbacks.onError(err);
        controller.error(err);
      }
    },
    async cancel() {
      await reader.cancel();
    },
  });
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractBalancedObject(text: string): unknown | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        const parsed = tryParseJson(text.slice(start, i + 1));
        return parsed === undefined ? null : parsed;
      }
    }
  }
  return null;
}

/** Robust JSON extraction from LLM output: a straight parse first, then a
 *  fenced ```json ... ``` block, then the first balanced {...} span. Used to
 *  degrade gracefully when a model ignores `response_format` and wraps its
 *  JSON in prose or markdown fences anyway. */
export function extractJsonBlock(text: string): unknown | null {
  const direct = tryParseJson(text.trim());
  if (direct !== undefined) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParseJson(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }

  return extractBalancedObject(text);
}

export async function chatCompletionJSON(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}): Promise<unknown> {
  let res: Response;
  try {
    res = await callOpenRouter({ ...opts, stream: false, responseFormatJson: true });
  } catch {
    // Some OpenRouter-routed models reject response_format entirely — retry
    // once without it; extractJsonBlock below still has to do the work of
    // finding JSON in whatever prose comes back either way.
    res = await callOpenRouter({ ...opts, stream: false, responseFormatJson: false });
  }

  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new OpenRouterError('OpenRouter response had no message content');
  }

  const parsed = extractJsonBlock(content);
  if (parsed === null) {
    throw new OpenRouterError('Could not parse JSON from OpenRouter response');
  }
  return parsed;
}
