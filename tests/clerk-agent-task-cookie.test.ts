import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import {
  assertClerkDevelopmentAgentTaskUrl,
  consumeClerkDevelopmentAgentTask,
  secureSameSiteNoneCookieEntries,
} from '../scripts/lib/clerk-development-cookie.mjs';

describe('Agent Task development cookie compatibility', () => {
  it('accepts only Clerk development Agent Task ticket URLs', () => {
    expect(assertClerkDevelopmentAgentTaskUrl(
      'https://example.clerk.accounts.dev/v1/agents/tasks?ticket=opaque',
    ).hostname).toBe('example.clerk.accounts.dev');

    expect(() => assertClerkDevelopmentAgentTaskUrl(
      'https://attacker.example/v1/agents/tasks?ticket=opaque',
    )).toThrow('unexpected Agent Task URL');
    expect(() => assertClerkDevelopmentAgentTaskUrl(
      'http://example.clerk.accounts.dev/v1/agents/tasks?ticket=opaque',
    )).toThrow('unexpected Agent Task URL');
  });

  it('leaves responses without affected cookies unchanged', () => {
    expect(secureSameSiteNoneCookieEntries([], 'https://example.com')).toEqual([]);
  });

  it('creates secure browser entries from affected Clerk response cookies', () => {
    const cookieLines = [
      '__client=opaque==; Path=/; Domain=example.accounts.dev; SameSite=None; HttpOnly',
      '__session=opaque; Path=/handoff; SameSite=None',
      '__lax=opaque; Path=/; SameSite=Lax; HttpOnly',
      'unrelated=opaque; Path=/; SameSite=None',
    ];

    expect(secureSameSiteNoneCookieEntries(cookieLines, 'https://example.accounts.dev/v1/client/handshake')).toEqual([
      {
        name: '__client',
        value: 'opaque==',
        domain: 'example.accounts.dev',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      },
      {
        name: '__session',
        value: 'opaque',
        domain: 'example.accounts.dev',
        path: '/handoff',
        httpOnly: false,
        secure: true,
        sameSite: 'None',
      },
    ]);
  });

  it('rejects cookie domains outside the response host', () => {
    const cookieLines = ['__session=opaque; Domain=other.example; Path=/; SameSite=None'];
    expect(secureSameSiteNoneCookieEntries(cookieLines, 'https://app.example/')).toEqual([]);
  });

  it('consumes each validated handoff response exactly once without following redirects', async () => {
    const target = new URL('https://studyus-agent-e2e.dawka.workers.dev');
    const taskUrl = 'https://example.clerk.accounts.dev/v1/agents/tasks?ticket=opaque';
    const response = ({ url, location, cookies = [] }: {
      url: string;
      location: string;
      cookies?: string[];
    }) => ({
      url: () => url,
      status: () => 307,
      headers: () => ({ location }),
      headersArray: async () => cookies.map(value => ({ name: 'Set-Cookie', value })),
    });
    const get = vi.fn()
      .mockResolvedValueOnce(response({
        url: taskUrl,
        location: `${target.origin}/planner?__clerk_handshake=opaque&__clerk_db_jwt=opaque&agent_task_e2e=1`,
        cookies: ['__client=opaque; Path=/; SameSite=None; HttpOnly'],
      }))
      .mockResolvedValueOnce(response({
        url: `${target.origin}/planner?__clerk_handshake=opaque`,
        location: `${target.origin}/planner?agent_task_e2e=1`,
        cookies: ['__session=signed-value; Path=/; SameSite=None'],
      }));
    const addCookies = vi.fn();
    const context = { request: { get }, addCookies };

    const result = await consumeClerkDevelopmentAgentTask({ context, target, agentTaskUrl: taskUrl });

    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls).toEqual([
      [taskUrl, { maxRedirects: 0 }],
      [`${target.origin}/planner?__clerk_handshake=opaque&__clerk_db_jwt=opaque&agent_task_e2e=1`, { maxRedirects: 0 }],
    ]);
    expect(addCookies).toHaveBeenCalledTimes(2);
    expect(addCookies.mock.calls[1][0][0]).toMatchObject({ value: 'signed-value', secure: true });
    expect(result.finalUrl.href).toBe(`${target.origin}/planner?agent_task_e2e=1`);
  });

  it('stops before a follow-up request when Clerk redirects off the isolated target', async () => {
    const taskUrl = 'https://example.clerk.accounts.dev/v1/agents/tasks?ticket=opaque';
    const get = vi.fn().mockResolvedValue({
      url: () => taskUrl,
      status: () => 307,
      headers: () => ({ location: 'https://attacker.example/planner?__clerk_handshake=x&__clerk_db_jwt=y' }),
      headersArray: async () => [],
    });
    const context = { request: { get }, addCookies: vi.fn() };

    await expect(consumeClerkDevelopmentAgentTask({
      context,
      target: new URL('https://studyus-agent-e2e.dawka.workers.dev'),
      agentTaskUrl: taskUrl,
    })).rejects.toThrow('unexpected development handoff destination');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
