// Coverage for src/lib/apiClient.ts — the shared fetch/parse/fallback
// helper that ~17 components and stores/tasks.ts used to hand-roll
// independently. Mocks global fetch the same way tests/stores-tasks.test.ts
// does; no DOM or cloudflare:test binding involved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, NETWORK_ERROR_MESSAGE } from '../src/lib/apiClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('returns ok:true with the envelope data on a 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: { id: '1' } }), { status: 200 })),
    );
    const result = await apiFetch<{ id: string }>('/api/v1/thing');
    expect(result).toEqual({ ok: true, data: { id: '1' } });
  });

  it('surfaces the server error message on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'invalid_input', message: 'Title is required' } }), { status: 400 }),
      ),
    );
    const result = await apiFetch('/api/v1/thing', {}, 'Failed to save');
    expect(result).toEqual({ ok: false, error: 'Title is required', reason: 'http' });
  });

  it('falls back to the call-site message when a non-ok body has no error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const result = await apiFetch('/api/v1/thing', {}, 'Failed to save');
    expect(result).toEqual({ ok: false, error: 'Failed to save', reason: 'http' });
  });

  it('falls back to the call-site message when a non-ok body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 500 })));
    const result = await apiFetch('/api/v1/thing', {}, 'Failed to save');
    expect(result).toEqual({ ok: false, error: 'Failed to save', reason: 'http' });
  });

  it('uses the default network message when fetch itself rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const result = await apiFetch('/api/v1/thing', {}, 'Failed to save');
    expect(result).toEqual({ ok: false, error: NETWORK_ERROR_MESSAGE, reason: 'network' });
  });

  it('uses a call-site-supplied network message override when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const result = await apiFetch('/api/v1/thing', {}, 'Failed to save', 'Network error.');
    expect(result).toEqual({ ok: false, error: 'Network error.', reason: 'network' });
  });

  it('passes init through to fetch unchanged (method, headers, body)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/api/v1/thing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/thing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
  });
});
