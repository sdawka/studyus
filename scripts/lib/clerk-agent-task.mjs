import { createClerkClient } from '@clerk/backend';
import { createAgentTestingTask } from '@clerk/testing/playwright';

import {
  ensureClerkE2EUser,
  loadClerkE2EEnv,
  setupClerkTestingContext,
  setupClerkTestingWorker,
} from './clerk-e2e-auth.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const USED_TASK_CODE = 'agent_task_cannot_be_revoked';

function assertIsolatedDevelopmentTarget(baseUrl) {
  const target = new URL(baseUrl);
  if (!LOCAL_HOSTS.has(target.hostname)) {
    throw new Error('Clerk Agent Task E2E is restricted to an isolated local target.');
  }
  return target;
}

function safeNavigationHop(response, target) {
  if (!response.request().isNavigationRequest()) return null;
  const url = new URL(response.url());
  if (url.origin === target.origin) return `local:${response.status()}:${url.pathname}`;
  if (url.hostname.endsWith('.accounts.dev')) return `clerk:${response.status()}`;
  return `external:${response.status()}`;
}

/**
 * Create and consume a one-use Clerk Agent Task without exposing its URL.
 * Returns only non-secret task metadata and the protected Studyus response.
 */
export async function authenticateWithClerkAgentTask({ context, page, baseUrl }) {
  const target = assertIsolatedDevelopmentTarget(baseUrl);
  const env = loadClerkE2EEnv();
  await setupClerkTestingWorker();
  await context.clearCookies();

  const user = await ensureClerkE2EUser();
  const redirectUrl = new URL('/planner?agent_task_e2e=1', target).href;
  const agentTask = await createAgentTestingTask({
    secretKey: env.secretKey,
    onBehalfOf: { userId: user.id },
    permissions: '*',
    agentName: 'studyus-e2e',
    taskDescription: 'Verify the protected Studyus learner journey',
    redirectUrl,
    sessionMaxDurationInSeconds: 300,
  });

  const client = createClerkClient({ secretKey: env.secretKey });
  const revoke = () => client.agentTasks.revoke(agentTask.agentTaskId);
  const revokeDelegatedSessionsForTask = async () => {
    const sessions = await client.sessions.getSessionList({ userId: user.id, limit: 100 });
    const matches = sessions.data.filter(session =>
      session.status === 'active' &&
      session.actor?.type === 'agent' &&
      session.actor?.task_id === agentTask.agentTaskId
    );
    if (matches.length > 1) {
      throw new Error('Refusing Agent Task cleanup: multiple active sessions matched one task.');
    }
    if (matches[0]) await client.sessions.revokeSession(matches[0].id);
    return matches.length;
  };
  const navigationHops = [];
  const recordHop = response => {
    const hop = safeNavigationHop(response, target);
    if (hop) navigationHops.push(hop);
  };
  page.on('response', recordHop);
  try {
    // setupClerkTestingToken's route handler assumes every FAPI response is
    // JSON. Agent Task URLs redirect to app HTML, so installing that handler
    // before this navigation consumes the one-use URL once in route.fetch()
    // and then retries it. Add the testing token directly for this navigation.
    const consumptionUrl = new URL(agentTask.url);
    if (process.env.CLERK_TESTING_TOKEN) {
      consumptionUrl.searchParams.set('__clerk_testing_token', process.env.CLERK_TESTING_TOKEN);
    }
    await page.goto(consumptionUrl.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForURL(url => url.origin === target.origin && url.pathname === '/planner', {
      timeout: 60_000,
    });
    await setupClerkTestingContext(context);
    await page.waitForFunction(() => window.Clerk?.loaded && Boolean(window.Clerk.session?.id));
    const sessionId = await page.evaluate(() => window.Clerk.session.id);

    const profile = await context.request.get(new URL('/api/v1/user', target).href);
    return {
      agentTaskId: agentTask.agentTaskId,
      agentId: agentTask.agentId,
      expectedLocalUserId: env.externalId,
      profile,
      async revokeDelegatedSession() {
        let taskRevokeError;
        try {
          await revoke();
        } catch (error) {
          taskRevokeError = error;
        }
        const taskErrorCodes = Array.isArray(taskRevokeError?.errors)
          ? taskRevokeError.errors.map(item => item?.code)
          : [];
        try {
          if (!taskErrorCodes.includes(USED_TASK_CODE)) {
            throw new Error('Consumed Agent Task did not report Clerk\'s expected one-use state.');
          }
        } finally {
          await client.sessions.revokeSession(sessionId);
        }
      },
    };
  } catch {
    let revocationState = 'failed';
    try {
      await revoke();
      revocationState = 'succeeded';
    } catch (error) {
      const codes = Array.isArray(error?.errors) ? error.errors.map(item => item?.code) : [];
      if (codes.includes(USED_TASK_CODE)) revocationState = 'was already consumed';
    }
    let delegatedSessionCleanup = 'failed';
    try {
      const count = await revokeDelegatedSessionsForTask();
      delegatedSessionCleanup = count === 1 ? 'revoked one exact session' : 'found no active exact session';
    } catch {
      // The fixed label keeps Clerk identifiers and provider errors out of output.
    }
    throw new Error(
      `Clerk Agent Task did not establish the local protected session; task revocation ${revocationState}; ` +
        `delegated session cleanup ${delegatedSessionCleanup}; ` +
        `sanitized navigation: ${navigationHops.join(' > ') || 'none'}.`,
    );
  } finally {
    page.off('response', recordHop);
  }
}
