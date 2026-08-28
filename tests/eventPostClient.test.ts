import { afterEach, describe, expect, it, vi } from 'vitest';
import { postManualEvent } from '../src/lib/eventPostClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

function requestKey(fetchMock: ReturnType<typeof vi.fn>, call: number): string | null {
  const init = fetchMock.mock.calls[call][1] as RequestInit;
  return new Headers(init.headers).get('Idempotency-Key');
}

describe('postManualEvent', () => {
  it('keeps one UUID key and identical body across an ambiguous retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'event-1' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = { type: 'reading_done', payload: { note: 'Chapter 2' } };

    const failed = await postManualEvent(body, null, 'Could not log that event.');
    expect(failed.result).toMatchObject({ ok: false, reason: 'network' });
    expect(failed.pendingAttempt).not.toBeNull();

    const retried = await postManualEvent(body, failed.pendingAttempt, 'Could not log that event.');
    expect(retried.result).toMatchObject({ ok: true, data: { id: 'event-1' } });
    expect(retried.pendingAttempt).toBeNull();
    expect(retried.attempt.idempotencyKey).toBe(failed.attempt.idempotencyKey);
    expect(requestKey(fetchMock, 0)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(requestKey(fetchMock, 1)).toBe(requestKey(fetchMock, 0));
    expect((fetchMock.mock.calls[1][1] as RequestInit).body).toBe((fetchMock.mock.calls[0][1] as RequestInit).body);
  });

  it('rotates the key when the learner changes the submission after an error', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('offline');
    });
    vi.stubGlobal('fetch', fetchMock);

    const failed = await postManualEvent({ type: 'reading_done' }, null, 'Failed');
    await postManualEvent({ type: 'video_watched' }, failed.pendingAttempt, 'Failed');

    expect(requestKey(fetchMock, 1)).not.toBe(requestKey(fetchMock, 0));
  });

  it('retains the attempt after an HTTP error and clears it only on success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'internal_error', message: 'Try again' } }), { status: 500 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'event-1' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const failed = await postManualEvent({ type: 'reading_done' }, null, 'Failed');
    expect(failed.pendingAttempt).not.toBeNull();
    const succeeded = await postManualEvent({ type: 'reading_done' }, failed.pendingAttempt, 'Failed');
    expect(succeeded.pendingAttempt).toBeNull();
    expect(requestKey(fetchMock, 1)).toBe(requestKey(fetchMock, 0));
  });
});
