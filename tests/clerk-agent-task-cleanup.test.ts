import { describe, expect, it, vi } from 'vitest';

import { revokeDelegatedSessionsForAgentTask } from '../scripts/lib/clerk-agent-task.mjs';

describe('Agent Task session cleanup', () => {
  it('paginates and revokes every active session for the exact task', async () => {
    const unrelated = Array.from({ length: 99 }, (_, index) => ({
      id: `other-${index}`,
      status: 'active',
      actor: { type: 'agent', task_id: 'other-task' },
    }));
    const pages = [
      [...unrelated, { id: 'match-1', status: 'active', actor: { type: 'agent', task_id: 'task-1' } }],
      [
        { id: 'match-2', status: 'active', actor: { type: 'agent', task_id: 'task-1' } },
        { id: 'inactive', status: 'revoked', actor: { type: 'agent', task_id: 'task-1' } },
      ],
    ];
    const getSessionList = vi.fn(({ offset }) => Promise.resolve({
      data: offset === 0 ? pages[0] : pages[1],
      totalCount: 102,
    }));
    const revokeSession = vi.fn().mockResolvedValue(undefined);
    const client = { sessions: { getSessionList, revokeSession } };

    await expect(revokeDelegatedSessionsForAgentTask({
      client,
      userId: 'user-1',
      agentTaskId: 'task-1',
    })).resolves.toBe(2);

    expect(getSessionList).toHaveBeenCalledTimes(2);
    expect(revokeSession.mock.calls.map(([id]) => id).sort()).toEqual(['match-1', 'match-2']);
  });
});
