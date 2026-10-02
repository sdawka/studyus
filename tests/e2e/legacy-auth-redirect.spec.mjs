import { expect, test } from '@playwright/test';

for (const [path, destination] of [
  ['/sign-in', '/dashboard'],
  ['/sign-in?return=%2F', '/dashboard'],
  ['/sign-in?redirect_url=%2Fplanner', '/planner'],
  ['/sign-in?return=https%3A%2F%2Fother.example%2F', '/dashboard'],
  ['/sign-in?from=demo', '/onboarding?import=demo'],
  ['/sign-up', '/onboarding'],
]) {
  test(`auth handoff from ${path} stays in the app at ${destination}`, async ({ request, baseURL }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    const encoded = html.match(/data-clerk-props="([^"]*)"/)?.[1];
    expect(encoded).toBeTruthy();
    const decoded = encoded.replace(/&#(?:x([\da-f]+)|(\d+));/gi, (_, hex, decimal) =>
      String.fromCodePoint(parseInt(hex ?? decimal, hex ? 16 : 10)))
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const props = JSON.parse(decoded);
    expect(new URL(props.forceRedirectUrl, baseURL).pathname + new URL(props.forceRedirectUrl, baseURL).search).toBe(destination);
    expect(props.fallbackRedirectUrl).toBe(destination);
  });
}
