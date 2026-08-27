export const CANONICAL_APP_ORIGIN = 'https://studyus.app';

const RAW_DEPLOY_HOSTS = new Set(['studyus.dawka.workers.dev']);

/** Keep Clerk and browser requests on the production origin it is configured for. */
export function canonicalRedirectUrl(url: URL): URL | null {
  if (!RAW_DEPLOY_HOSTS.has(url.hostname)) return null;
  const canonical = new URL(url.pathname + url.search, CANONICAL_APP_ORIGIN);
  return canonical;
}
