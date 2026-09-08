import { expect, test } from '@playwright/test';

import { authenticateWithClerkAgentTask } from '../../scripts/lib/clerk-agent-task.mjs';

test.use({ trace: 'off' });

test('a consumed Clerk Agent Task reaches the protected learner journey', async ({ context, page, baseURL }) => {
  test.skip(process.env.STUDYUS_AGENT_TASK_DIAGNOSTIC !== '1', 'Explicit Agent Tasks diagnostic opt-in required');
  test.skip(process.env.STUDYUS_ISOLATED_AUDIT !== '1', 'Disposable local Clerk/D1 journey required');
  test.setTimeout(180_000);

  const result = await authenticateWithClerkAgentTask({ context, page, baseUrl: baseURL });
  try {
    expect(result.agentTaskId).toMatch(/^agttsk_/);
    expect(result.agentId).toBeTruthy();
    expect(result.profile.ok()).toBe(true);
    const profile = await result.profile.json();
    expect(profile.data?.id).toBe(result.expectedLocalUserId);
    await expect(page).toHaveURL(/\/planner(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Planner', exact: true })).toBeVisible();

    const title = `Synthetic Agent Task journey ${Date.now()}`;
    const created = await context.request.post('/api/v1/tasks', {
      data: { title, estimated_minutes: 15, priority: 1 },
    });
    expect(created.status()).toBe(201);
    const task = (await created.json()).data;
    try {
      const listed = await context.request.get('/api/v1/tasks');
      expect(listed.ok()).toBe(true);
      expect((await listed.json()).data).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: task.id, title })]),
      );
    } finally {
      const deleted = await context.request.delete(`/api/v1/tasks/${task.id}`);
      expect(deleted.ok()).toBe(true);
    }
  } finally {
    await result.revokeDelegatedSession();
    await expect.poll(async () => {
      const response = await context.request.get('/api/v1/user', { maxRedirects: 0 });
      return response.status();
    }, { timeout: 70_000 }).toBe(401);
  }
});
