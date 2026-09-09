const SAME_SITE_NONE = /(?:^|;\s*)SameSite=None(?:;|$)/i;
const SECURE = /(?:^|;\s*)Secure(?:;|$)/i;

const CLERK_AUTH_COOKIE = /^__(?:clerk|client|session|dev_)/i;

export function assertClerkDevelopmentAgentTaskUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.clerk.accounts.dev') ||
    url.pathname !== '/v1/agents/tasks' ||
    !url.searchParams.has('ticket')
  ) {
    throw new Error('Clerk returned an unexpected Agent Task URL.');
  }
  return url;
}

/** Preserve Clerk-issued cookie values while adding the browser-required
 * Secure attribute to affected development-handshake cookies. */
export function secureSameSiteNoneCookieEntries(cookieLines, responseUrl) {
  const responseHost = new URL(responseUrl).hostname;

  return cookieLines.flatMap(cookieLine => {
    if (!SAME_SITE_NONE.test(cookieLine) || SECURE.test(cookieLine)) return [];
    const [nameValue, ...attributeParts] = cookieLine.split(';');
    const separator = nameValue.indexOf('=');
    if (separator <= 0) return [];
    const name = nameValue.slice(0, separator);
    if (!CLERK_AUTH_COOKIE.test(name)) return [];
    const attributes = new Map(
      attributeParts.map(part => {
        const [name, ...value] = part.trim().split('=');
        return [name.toLowerCase(), value.join('=')];
      }),
    );
    const domain = attributes.get('domain')?.replace(/^\./, '') || responseHost;
    if (domain !== responseHost) return [];
    const expires = attributes.get('expires');
    const parsedExpiry = expires ? Date.parse(expires) / 1000 : undefined;

    return [{
      name,
      value: nameValue.slice(separator + 1),
      domain,
      path: attributes.get('path') || '/',
      httpOnly: attributes.has('httponly'),
      secure: true,
      sameSite: 'None',
      ...(Number.isFinite(parsedExpiry) ? { expires: parsedExpiry } : {}),
    }];
  });
}

async function installAffectedResponseCookies(context, response) {
  const cookieLines = (await response.headersArray())
    .filter(header => header.name.toLowerCase() === 'set-cookie')
    .map(header => header.value);
  const cookieEntries = secureSameSiteNoneCookieEntries(cookieLines, response.url());
  if (cookieEntries.length) await context.addCookies(cookieEntries);
  return cookieEntries.length;
}

function redirectLocation(response) {
  const location = response.headers().location;
  if (response.status() < 300 || response.status() >= 400 || !location) {
    throw new Error('Clerk development handoff did not return the expected redirect.');
  }
  return new URL(location, response.url());
}

export async function consumeClerkDevelopmentAgentTask({ context, target, agentTaskUrl }) {
  const validatedTaskUrl = assertClerkDevelopmentAgentTaskUrl(agentTaskUrl);
  const taskResponse = await context.request.get(validatedTaskUrl.href, { maxRedirects: 0 });
  let installedCookieCount = await installAffectedResponseCookies(context, taskResponse);
  const handshakeUrl = redirectLocation(taskResponse);
  if (
    handshakeUrl.origin !== target.origin ||
    handshakeUrl.pathname !== '/planner' ||
    !handshakeUrl.searchParams.has('__clerk_handshake') ||
    !handshakeUrl.searchParams.has('__clerk_db_jwt')
  ) {
    throw new Error('Clerk Agent Task returned an unexpected development handoff destination.');
  }

  const handshakeResponse = await context.request.get(handshakeUrl.href, { maxRedirects: 0 });
  installedCookieCount += await installAffectedResponseCookies(context, handshakeResponse);
  const finalUrl = redirectLocation(handshakeResponse);
  if (
    finalUrl.origin !== target.origin ||
    finalUrl.pathname !== '/planner' ||
    finalUrl.searchParams.get('agent_task_e2e') !== '1' ||
    finalUrl.searchParams.has('__clerk_handshake') ||
    finalUrl.searchParams.has('__clerk_db_jwt')
  ) {
    throw new Error('Clerk development handshake returned an unexpected application destination.');
  }

  return { finalUrl, installedCookieCount };
}
