import { describe, expect, it, vi } from 'vitest';
import { extractJsonBlock, relayAsSSE } from '../src/lib/services/tutor/openrouter';

function sseUpstream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e));
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  for (const part of buffer.split('\n\n')) {
    const line = part.trim();
    if (line.startsWith('data:')) frames.push(line.slice(5).trim());
  }
  return frames;
}

describe('relayAsSSE', () => {
  it('re-emits upstream OpenAI-style SSE deltas as {delta} frames and accumulates the full text', async () => {
    const upstream = sseUpstream([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: ' world' } }] })}\n\n`,
      `data: [DONE]\n\n`,
    ]);

    let doneText: string | null = null;
    const relayed = relayAsSSE(upstream, { onDone: (text) => { doneText = text; } });
    const frames = await drain(relayed);

    const deltas = frames.map((f) => JSON.parse(f)).filter((f) => typeof f.delta === 'string');
    expect(deltas.map((d) => d.delta).join('')).toBe('Hello world');
    expect(frames.some((f) => JSON.parse(f).done === true)).toBe(true);
    expect(doneText).toBe('Hello world');
  });

  it('awaits onDone before the stream is fully drained (persistence happens before completion)', async () => {
    const upstream = sseUpstream([`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`, `data: [DONE]\n\n`]);
    const onDone = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const relayed = relayAsSSE(upstream, { onDone });
    await drain(relayed);
    expect(onDone).toHaveBeenCalledWith('x');
  });

  it('skips malformed SSE lines without throwing', async () => {
    const upstream = sseUpstream([`data: not json at all\n\n`, `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`, `data: [DONE]\n\n`]);
    const relayed = relayAsSSE(upstream);
    const frames = await drain(relayed);
    const deltas = frames.map((f) => JSON.parse(f)).filter((f) => typeof f.delta === 'string');
    expect(deltas.map((d) => d.delta).join('')).toBe('ok');
  });
});

describe('extractJsonBlock', () => {
  it('parses a direct JSON string', () => {
    expect(extractJsonBlock('{"a":1}')).toEqual({ a: 1 });
  });

  it('extracts JSON from a fenced markdown block', () => {
    expect(extractJsonBlock('Here you go:\n```json\n{"a":1}\n```\nHope that helps.')).toEqual({ a: 1 });
  });

  it('extracts the first balanced {...} span from surrounding prose', () => {
    expect(extractJsonBlock('Sure, the answer is {"a":1} and nothing else.')).toEqual({ a: 1 });
  });

  it('returns null when no JSON can be found', () => {
    expect(extractJsonBlock('no json here at all')).toBeNull();
  });
});
