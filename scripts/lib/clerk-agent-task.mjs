import { createClerkClient } from '@clerk/backend';

import {
  ensureClerkE2EUser,
  loadClerkE2EEnv,
} from './clerk-e2e-auth.mjs';
import { consumeClerkDevelopmentAgentTask } from './clerk-development-cookie.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const WORKERS_E2E_HOST = 'studyus-agent-e2e.dawka.workers.dev';
const USED_TASK_CODE = 'agent_task_cannot_be_revoked';

export async function revokeDelegatedSessionsForAgentTask({ client, userId, agentTaskId }) {
  const limit = 100;
  const matches = [];
  let offset = 0;

  while (true) {
    const page = await client.sessions.getSessionList({ userId, limit, offset });
    matches.push(...page.data.filter(session =>
      session.status === 'active' &&
      session.actor?.type === 'agent' &&
      session.actor?.task_id === agentTaskId
    ));
    offset += page.data.length;
    if (page.data.length < limit || offset >= page.totalCount) break;
  }

  const revocations = await Promise.allSettled(
    matches.map(session => client.sessions.revokeSession(session.id)),
  );
  const failed = revocations.filter(result => result.status === 'rejected').length;
  if (failed) throw new Error(`Failed to revoke ${failed} exact Agent Task session(s).`);
  return matches.length;
}

function assertIsolatedDevelopmentTarget(baseUrl) {
  const target = new URL(baseUrl);
  const localTarget = LOCAL_HOSTS.has(target.hostname);
  const explicitWorkersTarget =
    process.env.STUDYUS_AGENT_TASK_WORKERS === '1' &&
    target.protocol === 'https:' &&
    target.hostname === WORKERS_E2E_HOST;
  if (!localTarget && !explicitWorkersTarget) {
    throw new Error('Clerk Agent Task E2E is restricted to localhost or the explicit isolated Worker.');
  }
  return target;
}

function safeNavigationHop(response, target) {
  if (!response.request().isNavigationRequest()) return null;
  const url = new URL(response.url());
  const queryKeys = [...new Set(url.searchParams.keys())].sort();
  const queryShape = queryKeys.length ? `?${queryKeys.join(',')}` : '';
  if (url.origin === target.origin) return `local:${response.status()}:${url.pathname}${queryShape}`;
  if (url.hostname.endsWith('.accounts.dev')) {
    return `clerk:${url.hostname}:${response.status()}:${url.pathname}${queryShape}`;
  }
  return `external:${response.status()}`;
}

/**
 * Create and consume a one-use Clerk Agent Task without exposing its URL.
 * Returns only non-secret task metadata and the protected Studyus response.
 */
export async function authenticateWithClerkAgentTask({ context, page, baseUrl }) {
  const target = assertIsolatedDevelopmentTarget(baseUrl);
  const env = loadClerkE2EEnv();
  await context.clearCookies();

  const user = await ensureClerkE2EUser();
  const client = createClerkClient({ secretKey: env.secretKey });
  const domains = await client.domains.list();
  const isRegisteredSatellite = domains.data.some(domain => domain.isSatellite && domain.name === target.host);
  if (!isRegisteredSatellite) {
    throw new Error('The isolated Agent Task target is not registered as a Clerk satellite domain.');
  }
  const protectedPath = '/planner?agent_task_e2e=1';
  const agentTask = await client.agentTasks.create({
    onBehalfOf: { userId: user.id },
    permissions: '*',
    agentName: 'studyus-e2e',
    taskDescription: 'Verify the protected Studyus learner journey',
    redirectUrl: new URL(protectedPath, target).href,
    sessionMaxDurationInSeconds: 300,
  });
  const revoke = () => client.agentTasks.revoke(agentTask.agentTaskId);
  const navigationHops = [];
  let handoff = { installedCookieCount: 0 };
  const recordHop = response => {
    const hop = safeNavigationHop(response, target);
    if (hop) navigationHops.push(hop);
  };
  page.on('response', recordHop);
  try {
    handoff = await consumeClerkDevelopmentAgentTask({
      context,
      target,
      agentTaskUrl: agentTask.url,
    });
    await page.goto(handoff.finalUrl.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForURL(url => url.origin === target.origin && url.pathname === '/planner', {
      timeout: 60_000,
    });
    await page.waitForFunction(() => window.Clerk?.loaded && Boolean(window.Clerk.session?.id));
    const sessionId = await page.evaluate(() => window.Clerk.session.id);
    const session = await client.sessions.getSession(sessionId);
    if (session.actor?.type !== 'agent' || session.actor.task_id !== agentTask.agentTaskId) {
      throw new Error('Clerk session did not preserve the expected Agent Task actor.');
    }

    const profile = await context.request.get(new URL('/api/v1/user', target).href);
    return {
      agentTaskId: agentTask.agentTaskId,
      agentId: agentTask.agentId,
      sessionActorTaskId: session.actor.task_id,
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
      const count = await revokeDelegatedSessionsForAgentTask({
        client,
        userId: user.id,
        agentTaskId: agentTask.agentTaskId,
      });
      delegatedSessionCleanup = count > 0 ? `revoked ${count} exact session(s)` : 'found no active exact session';
    } catch {
      // The fixed label keeps Clerk identifiers and provider errors out of output.
    }
    throw new Error(
      `Clerk Agent Task did not establish the local protected session; task revocation ${revocationState}; ` +
        `delegated session cleanup ${delegatedSessionCleanup}; ` +
        `secured development cookies: ${handoff.installedCookieCount}; ` +
        `sanitized navigation: ${navigationHops.join(' > ') || 'none'}.`,
    );
  } finally {
    page.off('response', recordHop);
  }
}
